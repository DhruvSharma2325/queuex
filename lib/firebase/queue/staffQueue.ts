import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  runTransaction,
  serverTimestamp,
  where,
} from "firebase/firestore";

import { auth } from "@/lib/firebase/auth";
import { db } from "@/lib/firebase/firestore";

export type StaffQueueActionResult = {
  success: boolean;
  message: string;
  queueNumber?: number;
  queueCode?: string;
};

type StaffUserProfile = {
  role?: "student" | "staff";
  serviceId?: string;
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

/**
 * Verify that the currently authenticated Firebase user
 * is a staff member assigned to the requested service.
 *
 * This is a client-side validation for better UX.
 * Firestore Security Rules independently enforce the
 * same authorization on the database.
 */
async function verifyStaffAccess(
  serviceId: string
): Promise<void> {
  const currentUser = auth.currentUser;

  if (!currentUser) {
    throw new Error(
      "You must be logged in as staff to perform this action."
    );
  }

  const userRef = doc(
    db,
    "users",
    currentUser.uid
  );

  const userSnapshot =
    await getDoc(userRef);

  if (!userSnapshot.exists()) {
    throw new Error(
      "Staff profile not found."
    );
  }

  const profile =
    userSnapshot.data() as StaffUserProfile;

  if (profile.role !== "staff") {
    throw new Error(
      "You do not have staff permissions."
    );
  }

  if (profile.serviceId !== serviceId) {
    throw new Error(
      "You are not assigned to this service."
    );
  }
}

/**
 * Find the first waiting queue entry for a service.
 *
 * We query by serviceId only and sort the waiting
 * entries in the application. This avoids requiring
 * a composite Firestore index for the first version.
 */
async function getNextWaitingEntry(
  serviceId: string
) {
  const entriesRef = collection(
    db,
    "queueEntries"
  );

  const entriesQuery = query(
    entriesRef,
    where("serviceId", "==", serviceId),
    limit(50)
  );

  const snapshot =
    await getDocs(entriesQuery);

  if (snapshot.empty) {
    return null;
  }

  const entries = snapshot.docs
    .map((snapshot) => ({
      id: snapshot.id,
      ref: snapshot.ref,
      data:
        snapshot.data() as QueueEntryDocument,
    }))
    .filter(
      (entry) =>
        entry.data.status === "WAITING"
    )
    .sort(
      (a, b) =>
        a.data.queueNumber -
        b.data.queueNumber
    );

  return entries[0] ?? null;
}

/**
 * Call the next student in the queue.
 *
 * Steps:
 *
 * 1. Verify staff access.
 * 2. Find the first WAITING student.
 * 3. Re-read the queue and entry inside a transaction.
 * 4. Move currentNumber forward.
 * 5. Decrease waitingCount.
 * 6. Change the student to SERVING.
 *
 * Queue and entry are committed atomically.
 */
export async function callNext(
  serviceId: string
): Promise<StaffQueueActionResult> {
  if (!serviceId) {
    throw new Error(
      "A valid service is required."
    );
  }

  await verifyStaffAccess(serviceId);

  const nextEntry =
    await getNextWaitingEntry(serviceId);

  if (!nextEntry) {
    throw new Error(
      "There are no students waiting in this queue."
    );
  }

  const queueRef = doc(
    db,
    "queues",
    serviceId
  );

  const entryRef = nextEntry.ref;

  const result = await runTransaction(
    db,
    async (transaction) => {
      const queueSnapshot =
        await transaction.get(queueRef);

      const entrySnapshot =
        await transaction.get(entryRef);

      if (!queueSnapshot.exists()) {
        throw new Error(
          "The queue does not exist."
        );
      }

      if (!entrySnapshot.exists()) {
        throw new Error(
          "The queue entry no longer exists."
        );
      }

      const queue =
        queueSnapshot.data() as QueueDocument;

      const entry =
        entrySnapshot.data() as QueueEntryDocument;

      if (
        queue.serviceId !== serviceId
      ) {
        throw new Error(
          "Queue service mismatch."
        );
      }

      if (
        entry.serviceId !== serviceId
      ) {
        throw new Error(
          "Queue entry service mismatch."
        );
      }

      if (queue.status !== "OPEN") {
        throw new Error(
          "The queue is not currently open."
        );
      }

      if (entry.status !== "WAITING") {
        throw new Error(
          "This queue entry is no longer waiting. Please refresh."
        );
      }

      if (queue.waitingCount <= 0) {
        throw new Error(
          "The queue has no waiting students."
        );
      }

      /**
       * The next student must be exactly the next
       * queue number after the currently serving number.
       */
      if (
        entry.queueNumber !==
        queue.currentNumber + 1
      ) {
        throw new Error(
          "Queue state is out of sync. Please refresh and try again."
        );
      }

      transaction.update(queueRef, {
        currentNumber:
          entry.queueNumber,

        waitingCount:
          queue.waitingCount - 1,

        updatedAt:
          serverTimestamp(),
      });

      transaction.update(entryRef, {
        status: "SERVING",

        updatedAt:
          serverTimestamp(),
      });

      return {
        success: true,

        message:
          `${entry.queueCode} is now being served.`,

        queueNumber:
          entry.queueNumber,

        queueCode:
          entry.queueCode,
      };
    }
  );

  return result;
}

/**
 * Mark the currently serving student as completed.
 */
export async function completeQueueEntry(
  serviceId: string,
  entryId: string
): Promise<StaffQueueActionResult> {
  if (!serviceId || !entryId) {
    throw new Error(
      "Service and queue entry are required."
    );
  }

  await verifyStaffAccess(serviceId);

  const entryRef = doc(
    db,
    "queueEntries",
    entryId
  );

  const result = await runTransaction(
    db,
    async (transaction) => {
      const entrySnapshot =
        await transaction.get(entryRef);

      if (!entrySnapshot.exists()) {
        throw new Error(
          "Queue entry not found."
        );
      }

      const entry =
        entrySnapshot.data() as QueueEntryDocument;

      if (
        entry.serviceId !== serviceId
      ) {
        throw new Error(
          "This queue entry belongs to another service."
        );
      }

      if (
        entry.status !== "SERVING"
      ) {
        throw new Error(
          "Only a serving queue entry can be completed."
        );
      }

      transaction.update(entryRef, {
        status: "COMPLETED",
        updatedAt: serverTimestamp(),
      });

      return {
        success: true,
        message:
          `${entry.queueCode} has been completed.`,
        queueNumber:
          entry.queueNumber,
        queueCode:
          entry.queueCode,
      };
    }
  );

  return result;
}

/**
 * Skip the currently serving student.
 */
export async function skipQueueEntry(
  serviceId: string,
  entryId: string
): Promise<StaffQueueActionResult> {
  if (!serviceId || !entryId) {
    throw new Error(
      "Service and queue entry are required."
    );
  }

  await verifyStaffAccess(serviceId);

  const entryRef = doc(
    db,
    "queueEntries",
    entryId
  );

  const result = await runTransaction(
    db,
    async (transaction) => {
      const entrySnapshot =
        await transaction.get(entryRef);

      if (!entrySnapshot.exists()) {
        throw new Error(
          "Queue entry not found."
        );
      }

      const entry =
        entrySnapshot.data() as QueueEntryDocument;

      if (
        entry.serviceId !== serviceId
      ) {
        throw new Error(
          "This queue entry belongs to another service."
        );
      }

      if (
        entry.status !== "SERVING"
      ) {
        throw new Error(
          "Only a serving queue entry can be skipped."
        );
      }

      transaction.update(entryRef, {
        status: "SKIPPED",
        updatedAt: serverTimestamp(),
      });

      return {
        success: true,
        message:
          `${entry.queueCode} has been skipped.`,
        queueNumber:
          entry.queueNumber,
        queueCode:
          entry.queueCode,
      };
    }
  );

  return result;
}

/**
 * Change queue status.
 *
 * Allowed states:
 *
 * OPEN
 * PAUSED
 * CLOSED
 */
export async function setQueueStatus(
  serviceId: string,
  status:
    | "OPEN"
    | "PAUSED"
    | "CLOSED"
): Promise<StaffQueueActionResult> {
  if (!serviceId) {
    throw new Error(
      "A valid service is required."
    );
  }

  await verifyStaffAccess(serviceId);

  const queueRef = doc(
    db,
    "queues",
    serviceId
  );

  const result = await runTransaction(
    db,
    async (transaction) => {
      const queueSnapshot =
        await transaction.get(queueRef);

      if (!queueSnapshot.exists()) {
        throw new Error(
          "The queue does not exist."
        );
      }

      const queue =
        queueSnapshot.data() as QueueDocument;

      if (
        queue.serviceId !== serviceId
      ) {
        throw new Error(
          "Queue service mismatch."
        );
      }

      if (queue.status === status) {
        return {
          success: true,
          message:
            `Queue is already ${status.toLowerCase()}.`,
        };
      }

      transaction.update(queueRef, {
        status,
        updatedAt: serverTimestamp(),
      });

      return {
        success: true,
        message:
          `Queue is now ${status.toLowerCase()}.`,
      };
    }
  );

  return result;
}