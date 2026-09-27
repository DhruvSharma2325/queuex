import {
  doc,
  runTransaction,
  serverTimestamp,
} from "firebase/firestore";

import { db } from "@/lib/firebase/firestore";

export type JoinQueueResult = {
  queueNumber: number;
  queueCode: string;
  alreadyJoined: boolean;
};

type QueueDocument = {
  serviceId: string;
  currentNumber: number;
  nextNumber: number;
  waitingCount: number;
  status: "OPEN" | "PAUSED" | "CLOSED";
};

type QueueEntryDocument = {
  userId: string;
  serviceId: string;
  queueNumber: number;
  queueCode: string;
  status:
    | "WAITING"
    | "SERVING"
    | "COMPLETED"
    | "SKIPPED";
};

export async function joinQueue(
  userId: string,
  serviceId: string
): Promise<JoinQueueResult> {
  if (!userId) {
    throw new Error(
      "You must be logged in to join a queue."
    );
  }

  if (!serviceId) {
    throw new Error(
      "A valid campus service is required."
    );
  }

  const queueRef = doc(
    db,
    "queues",
    serviceId
  );

  /*
   * We intentionally keep one queue-entry document
   * per student + service.
   *
   * If the previous entry is COMPLETED or SKIPPED,
   * that same document can be reused for a new queue visit.
   */
  const entryId = `${userId}_${serviceId}`;

  const entryRef = doc(
    db,
    "queueEntries",
    entryId
  );

  const result = await runTransaction(
    db,
    async (transaction) => {
      /*
       * All reads happen before writes.
       */

      const queueSnapshot =
        await transaction.get(queueRef);

      const entrySnapshot =
        await transaction.get(entryRef);

      if (!queueSnapshot.exists()) {
        throw new Error(
          "This service does not have an active queue yet."
        );
      }

      const queue =
        queueSnapshot.data() as QueueDocument;

      /*
       * -------------------------------------------------------
       * QUEUE VALIDATION
       * -------------------------------------------------------
       */

      if (queue.serviceId !== serviceId) {
        throw new Error(
          "Queue service mismatch."
        );
      }

      if (queue.status !== "OPEN") {
        throw new Error(
          "This queue is currently unavailable."
        );
      }

      /*
       * -------------------------------------------------------
       * EXISTING QUEUE ENTRY
       * -------------------------------------------------------
       */

      if (entrySnapshot.exists()) {
        const existingEntry =
          entrySnapshot.data() as QueueEntryDocument;

        /*
         * Safety check.
         */
        if (
          existingEntry.userId !== userId
        ) {
          throw new Error(
            "This queue entry belongs to another user."
          );
        }

        if (
          existingEntry.serviceId !== serviceId
        ) {
          throw new Error(
            "This queue entry belongs to another service."
          );
        }

        /*
         * If the student is already waiting,
         * do not create another queue position.
         */
        if (
          existingEntry.status ===
          "WAITING"
        ) {
          return {
            queueNumber:
              existingEntry.queueNumber,

            queueCode:
              existingEntry.queueCode,

            alreadyJoined: true,
          };
        }

        /*
         * A student cannot join again while
         * their previous entry is currently being served.
         */
        if (
          existingEntry.status ===
          "SERVING"
        ) {
          throw new Error(
            "You are currently being served. Please wait until your service is completed."
          );
        }

        /*
         * COMPLETED or SKIPPED entries can be reused.
         */
      }

      /*
       * -------------------------------------------------------
       * ASSIGN NEW QUEUE NUMBER
       * -------------------------------------------------------
       */

      const assignedNumber =
        queue.nextNumber;

      const queueCode =
        `A-${String(assignedNumber).padStart(
          3,
          "0"
        )}`;

      /*
       * -------------------------------------------------------
       * UPDATE QUEUE
       * -------------------------------------------------------
       */

      transaction.update(queueRef, {
        nextNumber:
          assignedNumber + 1,

        waitingCount:
          queue.waitingCount + 1,

        updatedAt:
          serverTimestamp(),
      });

      /*
       * -------------------------------------------------------
       * CREATE OR REUSE QUEUE ENTRY
       * -------------------------------------------------------
       */

      transaction.set(
        entryRef,
        {
          userId,
          serviceId,
          queueNumber: assignedNumber,
          queueCode,
          status: "WAITING",

          /*
           * Keep the original joinedAt only for an
           * existing entry. For a fresh entry, create it.
           */
          ...(entrySnapshot.exists()
            ? {}
            : {
                joinedAt:
                  serverTimestamp(),
              }),

          updatedAt:
            serverTimestamp(),
        },
        {
          merge: true,
        }
      );

      return {
        queueNumber: assignedNumber,
        queueCode,
        alreadyJoined: false,
      };
    }
  );

  return result;
}