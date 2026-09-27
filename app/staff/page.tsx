"use client";

import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  where,
} from "firebase/firestore";
import {
  onAuthStateChanged,
  signOut,
  User,
} from "firebase/auth";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { auth } from "@/lib/firebase/auth";
import { db } from "@/lib/firebase/firestore";

import {
  callNext,
  completeQueueEntry,
  setQueueStatus,
  skipQueueEntry,
} from "@/lib/firebase/queue/staffQueue";

type QueueStatus =
  | "OPEN"
  | "PAUSED"
  | "CLOSED";

type EntryStatus =
  | "WAITING"
  | "SERVING"
  | "COMPLETED"
  | "SKIPPED";

type StaffProfile = {
  name?: string;
  email?: string;
  role?: string;
  serviceId?: string;
};

type Service = {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: string;
  status: QueueStatus;
  averageServiceTime: number;
};

type Queue = {
  serviceId: string;
  currentNumber: number;
  nextNumber: number;
  waitingCount: number;
  status: QueueStatus;
};

type QueueEntry = {
  id: string;
  userId: string;
  serviceId: string;
  queueNumber: number;
  queueCode: string;
  status: EntryStatus;
  joinedAt?: {
    seconds: number;
    nanoseconds: number;
  };
};

function formatTime(
  timestamp?: {
    seconds: number;
    nanoseconds: number;
  }
) {
  if (!timestamp) {
    return "—";
  }

  return new Date(
    timestamp.seconds * 1000
  ).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getStatusLabel(
  status: QueueStatus
) {
  switch (status) {
    case "OPEN":
      return "Open";

    case "PAUSED":
      return "Paused";

    case "CLOSED":
      return "Closed";

    default:
      return status;
  }
}

export default function StaffPage() {
  const router = useRouter();

  const [authUser, setAuthUser] =
    useState<User | null>(null);

  const [staffProfile, setStaffProfile] =
    useState<StaffProfile | null>(null);

  const [service, setService] =
    useState<Service | null>(null);

  const [queue, setQueue] =
    useState<Queue | null>(null);

  const [entries, setEntries] =
    useState<QueueEntry[]>([]);

  const [loading, setLoading] =
    useState(true);

  const [actionLoading, setActionLoading] =
    useState(false);

  const [actionMessage, setActionMessage] =
    useState("");

  const [error, setError] =
    useState("");


  /*
   * =========================================================
   * AUTHENTICATION + STAFF PROFILE
   * =========================================================
   */

  useEffect(() => {
    const unsubscribe =
      onAuthStateChanged(
        auth,
        async (user) => {
          if (!user) {
            router.replace("/login");
            return;
          }

          setAuthUser(user);

          try {
            const profileRef = doc(
              db,
              "users",
              user.uid
            );

            const profileSnapshot =
              await getDoc(profileRef);

            if (!profileSnapshot.exists()) {
              setError(
                "Your QueueX profile could not be found."
              );

              setLoading(false);
              return;
            }

            const profile =
              profileSnapshot.data() as StaffProfile;

            if (profile.role !== "staff") {
              router.replace("/dashboard");
              return;
            }

            if (!profile.serviceId) {
              setError(
                "Your staff account has no assigned service."
              );

              setLoading(false);
              return;
            }

            setStaffProfile(profile);
            setLoading(false);
          } catch (err) {
            console.error(err);

            setError(
              "Unable to load your staff profile."
            );

            setLoading(false);
          }
        }
      );

    return () => unsubscribe();
  }, [router]);


  /*
   * =========================================================
   * SERVICE LISTENER
   * =========================================================
   */

  useEffect(() => {
    if (!staffProfile?.serviceId) {
      return;
    }

    const serviceRef = doc(
      db,
      "services",
      staffProfile.serviceId
    );

    const unsubscribe =
      onSnapshot(
        serviceRef,
        (snapshot) => {
          if (!snapshot.exists()) {
            setError(
              "Your assigned service could not be found."
            );

            return;
          }

          setService({
            id: snapshot.id,
            ...(snapshot.data() as Omit<
              Service,
              "id"
            >),
          });
        },
        (snapshotError) => {
          console.error(
            "Service listener error:",
            snapshotError
          );

          setError(
            "Unable to load the assigned service."
          );
        }
      );

    return () => unsubscribe();
  }, [staffProfile?.serviceId]);


  /*
   * =========================================================
   * QUEUE LISTENER
   * =========================================================
   */

  useEffect(() => {
    if (!staffProfile?.serviceId) {
      return;
    }

    const queueRef = doc(
      db,
      "queues",
      staffProfile.serviceId
    );

    const unsubscribe =
      onSnapshot(
        queueRef,
        (snapshot) => {
          if (!snapshot.exists()) {
            setQueue(null);
            return;
          }

          setQueue({
            serviceId:
              staffProfile.serviceId!,
            ...(snapshot.data() as Omit<
              Queue,
              "serviceId"
            >),
          });
        },
        (snapshotError) => {
          console.error(
            "Queue listener error:",
            snapshotError
          );

          setError(
            "Unable to load live queue information."
          );
        }
      );

    return () => unsubscribe();
  }, [staffProfile?.serviceId]);


  /*
   * =========================================================
   * QUEUE ENTRIES LISTENER
   * =========================================================
   */

  useEffect(() => {
    if (!staffProfile?.serviceId) {
      return;
    }

    const entriesRef = collection(
      db,
      "queueEntries"
    );

    const entriesQuery = query(
      entriesRef,
      where(
        "serviceId",
        "==",
        staffProfile.serviceId
      )
    );

    const unsubscribe =
      onSnapshot(
        entriesQuery,
        (snapshot) => {
          const loadedEntries =
            snapshot.docs.map(
              (entrySnapshot) => ({
                id: entrySnapshot.id,
                ...(entrySnapshot.data() as Omit<
                  QueueEntry,
                  "id"
                >),
              })
            );

          loadedEntries.sort(
            (a, b) =>
              a.queueNumber -
              b.queueNumber
          );

          setEntries(loadedEntries);
        },
        (snapshotError) => {
          console.error(
            "Queue entries listener error:",
            snapshotError
          );

          setError(
            "Unable to load queue entries."
          );
        }
      );

    return () => unsubscribe();
  }, [staffProfile?.serviceId]);


  /*
   * =========================================================
   * DERIVED DATA
   * =========================================================
   */

  const waitingEntries = useMemo(() => {
    return entries.filter(
      (entry) =>
        entry.status === "WAITING"
    );
  }, [entries]);


  const servingEntry = useMemo(() => {
    return (
      entries.find(
        (entry) =>
          entry.status === "SERVING"
      ) ?? null
    );
  }, [entries]);


  const completedEntries = useMemo(() => {
    return entries.filter(
      (entry) =>
        entry.status === "COMPLETED"
    );
  }, [entries]);


  const skippedEntries = useMemo(() => {
    return entries.filter(
      (entry) =>
        entry.status === "SKIPPED"
    );
  }, [entries]);


  const estimatedWait =
    service && queue
      ? queue.waitingCount *
        service.averageServiceTime
      : 0;


  /*
   * =========================================================
   * ACTION HANDLER
   * =========================================================
   */

  async function performAction(
    action: () => Promise<{
      success: boolean;
      message: string;
    }>
  ) {
    setActionLoading(true);
    setActionMessage("");
    setError("");

    try {
      const result = await action();

      setActionMessage(
        result.message
      );
    } catch (err) {
      console.error(err);

      const message =
        err instanceof Error
          ? err.message
          : "Something went wrong.";

      setError(message);
    } finally {
      setActionLoading(false);
    }
  }


  /*
   * =========================================================
   * CALL NEXT
   * =========================================================
   */

  async function handleCallNext() {
    if (!staffProfile?.serviceId) {
      return;
    }

    await performAction(() =>
      callNext(
        staffProfile.serviceId!
      )
    );
  }


  /*
   * =========================================================
   * COMPLETE
   * =========================================================
   */

  async function handleComplete() {
    if (
      !staffProfile?.serviceId ||
      !servingEntry
    ) {
      return;
    }

    await performAction(() =>
      completeQueueEntry(
        staffProfile.serviceId!,
        servingEntry.id
      )
    );
  }


  /*
   * =========================================================
   * SKIP
   * =========================================================
   */

  async function handleSkip() {
    if (
      !staffProfile?.serviceId ||
      !servingEntry
    ) {
      return;
    }

    await performAction(() =>
      skipQueueEntry(
        staffProfile.serviceId!,
        servingEntry.id
      )
    );
  }


  /*
   * =========================================================
   * QUEUE STATUS
   * =========================================================
   */

  async function handleQueueStatus(
    status: QueueStatus
  ) {
    if (!staffProfile?.serviceId) {
      return;
    }

    await performAction(() =>
      setQueueStatus(
        staffProfile.serviceId!,
        status
      )
    );
  }


  /*
   * =========================================================
   * LOGOUT
   * =========================================================
   */

  async function handleLogout() {
    await signOut(auth);
    router.replace("/login");
  }


  /*
   * =========================================================
   * LOADING
   * =========================================================
   */

  if (loading) {
    return (
      <main className="min-h-screen bg-[#020817] text-white flex items-center justify-center">
        <div className="text-center">

          <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-2xl border border-cyan-400/30 bg-cyan-400/10">
            <span className="text-xl text-cyan-300">
              Q
            </span>
          </div>

          <p className="text-sm text-slate-400">
            Loading staff workspace...
          </p>

        </div>
      </main>
    );
  }


  /*
   * =========================================================
   * ERROR
   * =========================================================
   */

  if (error && !staffProfile) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#020817] px-6 text-white">

        <div className="w-full max-w-md rounded-3xl border border-red-500/20 bg-[#0b1628] p-8 text-center shadow-2xl">

          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border border-red-500/20 bg-red-500/10">

            <span className="text-2xl">
              !
            </span>

          </div>

          <h1 className="text-xl font-semibold">
            Staff access unavailable
          </h1>

          <p className="mt-3 text-sm leading-6 text-slate-400">
            {error}
          </p>

          <button
            onClick={() =>
              router.replace("/dashboard")
            }
            className="mt-7 w-full rounded-xl bg-cyan-400 px-5 py-3 font-semibold text-slate-950 transition hover:bg-cyan-300"
          >
            Back to Dashboard
          </button>

        </div>

      </main>
    );
  }


  /*
   * =========================================================
   * MAIN UI
   * =========================================================
   */

  return (
    <main className="min-h-screen bg-[#020817] text-white">

      {/* =====================================================
          NAVBAR
      ===================================================== */}

      <header className="sticky top-0 z-40 border-b border-white/[0.06] bg-[#020817]/90 backdrop-blur-xl">

        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4 lg:px-8">

          <div className="flex items-center gap-3">

            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-400 text-sm font-black text-slate-950 shadow-lg shadow-cyan-500/20">
              Q
            </div>

            <div>

              <div className="text-base font-bold tracking-tight">
                QueueX
              </div>

              <div className="text-[10px] font-medium text-cyan-300">
                Smart Campus Queues
              </div>

            </div>

          </div>


          <div className="flex items-center gap-3">

            <div className="hidden rounded-full border border-cyan-400/20 bg-cyan-400/5 px-4 py-2 text-xs text-cyan-300 sm:block">
              Staff Control Center
            </div>

            <button
              onClick={handleLogout}
              className="rounded-xl border border-slate-700 bg-slate-900/70 px-4 py-2.5 text-sm font-medium text-slate-200 transition hover:border-slate-500 hover:bg-slate-800"
            >
              Logout
            </button>

          </div>

        </div>

      </header>


      {/* =====================================================
          CONTENT
      ===================================================== */}

      <div className="mx-auto max-w-7xl px-6 py-10 lg:px-8 lg:py-14">

        {/* ===================================================
            PAGE HEADER
        =================================================== */}

        <section className="mb-10">

          <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/5 px-4 py-2 text-xs font-medium text-cyan-300">

            <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.8)]" />

            Staff Dashboard

          </div>


          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">

            <div>

              <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
                {service?.name ?? "Service"}
              </h1>

              <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-400 sm:text-base">
                Manage your campus queue in real time,
                call students, and control service availability.
              </p>

            </div>


            {service && (
              <div className="flex items-center gap-3">

                <span className="text-3xl">
                  {service.icon}
                </span>

                <div>

                  <p className="text-sm font-medium text-slate-200">
                    {service.category}
                  </p>

                  <p className="text-xs text-slate-500">
                    {service.description}
                  </p>

                </div>

              </div>
            )}

          </div>

        </section>


        {/* ===================================================
            NOTIFICATIONS
        =================================================== */}

        {error && (
          <div className="mb-6 rounded-2xl border border-red-400/20 bg-red-400/5 px-5 py-4 text-sm text-red-300">
            {error}
          </div>
        )}


        {actionMessage && (
          <div className="mb-6 rounded-2xl border border-emerald-400/20 bg-emerald-400/5 px-5 py-4 text-sm text-emerald-300">
            {actionMessage}
          </div>
        )}


        {/* ===================================================
            STATS
        =================================================== */}

        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">

          <div className="rounded-3xl border border-cyan-400/15 bg-[#0b1628] p-6 shadow-xl shadow-black/10">

            <div className="flex items-center justify-between">

              <span className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">
                Now Serving
              </span>

              <span className="text-cyan-300">
                ●
              </span>

            </div>

            <div className="mt-5 text-4xl font-bold tracking-tight text-cyan-300">
              {servingEntry
                ? servingEntry.queueCode
                : queue?.currentNumber
                  ? `A-${String(
                      queue.currentNumber
                    ).padStart(3, "0")}`
                  : "—"}
            </div>

            <p className="mt-2 text-xs text-slate-500">
              Current counter
            </p>

          </div>


          <div className="rounded-3xl border border-white/[0.06] bg-[#0b1628] p-6">

            <span className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">
              Waiting
            </span>

            <div className="mt-5 text-4xl font-bold tracking-tight">
              {queue?.waitingCount ?? 0}
            </div>

            <p className="mt-2 text-xs text-slate-500">
              Students in queue
            </p>

          </div>


          <div className="rounded-3xl border border-white/[0.06] bg-[#0b1628] p-6">

            <span className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">
              Estimated Wait
            </span>

            <div className="mt-5 text-4xl font-bold tracking-tight">
              {estimatedWait}
              <span className="ml-1 text-lg font-medium text-slate-400">
                min
              </span>
            </div>

            <p className="mt-2 text-xs text-slate-500">
              Approximate
            </p>

          </div>


          <div className="rounded-3xl border border-white/[0.06] bg-[#0b1628] p-6">

            <span className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">
              Queue Status
            </span>

            <div className="mt-5 flex items-center gap-3">

              <span
                className={`h-3 w-3 rounded-full ${
                  queue?.status === "OPEN"
                    ? "bg-emerald-400 shadow-[0_0_14px_rgba(52,211,153,0.8)]"
                    : queue?.status === "PAUSED"
                      ? "bg-amber-400"
                      : "bg-red-400"
                }`}
              />

              <span className="text-2xl font-bold">
                {queue
                  ? getStatusLabel(
                      queue.status
                    )
                  : "—"}
              </span>

            </div>

            <p className="mt-2 text-xs text-slate-500">
              Service availability
            </p>

          </div>

        </section>


        {/* ===================================================
            CONTROL CENTER
        =================================================== */}

        <section className="mt-8 grid gap-6 lg:grid-cols-[1.5fr_1fr]">

          {/* CALL NEXT */}

          <div className="relative overflow-hidden rounded-3xl border border-cyan-400/20 bg-gradient-to-br from-[#0b1d30] via-[#091728] to-[#071221] p-7 shadow-2xl shadow-cyan-950/20">

            <div className="absolute -right-20 -top-20 h-56 w-56 rounded-full bg-cyan-400/10 blur-3xl" />

            <div className="relative">

              <div className="flex items-center justify-between">

                <div>

                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300">
                    Queue Control
                  </p>

                  <h2 className="mt-2 text-2xl font-bold">
                    Ready for the next student?
                  </h2>

                </div>

                <div className="hidden h-12 w-12 items-center justify-center rounded-2xl border border-cyan-400/20 bg-cyan-400/10 sm:flex">
                  <span className="text-xl text-cyan-300">
                    →
                  </span>
                </div>

              </div>


              <p className="mt-3 max-w-xl text-sm leading-6 text-slate-400">
                Call the next student in numerical order.
                QueueX will update the queue and student's
                status together.
              </p>


              <button
                onClick={handleCallNext}
                disabled={
                  actionLoading ||
                  !queue ||
                  queue.status !== "OPEN" ||
                  queue.waitingCount <= 0 ||
                  !!servingEntry
                }
                className="mt-7 w-full rounded-2xl bg-cyan-400 px-6 py-5 text-lg font-black tracking-wide text-slate-950 shadow-xl shadow-cyan-500/10 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {actionLoading
                  ? "PROCESSING..."
                  : servingEntry
                    ? "STUDENT CURRENTLY SERVING"
                    : queue?.waitingCount
                      ? "CALL NEXT"
                      : "QUEUE EMPTY"}
              </button>


              {servingEntry && (
                <p className="mt-3 text-center text-xs text-slate-500">
                  Complete or skip the current student
                  before calling the next one.
                </p>
              )}

            </div>

          </div>


          {/* CURRENTLY SERVING */}

          <div className="rounded-3xl border border-white/[0.06] bg-[#0b1628] p-7">

            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
              Currently Serving
            </p>


            {servingEntry ? (
              <>

                <div className="mt-5">

                  <div className="text-5xl font-black tracking-tight text-cyan-300">
                    {servingEntry.queueCode}
                  </div>

                  <p className="mt-2 text-sm text-slate-400">
                    Queue #{servingEntry.queueNumber}
                  </p>

                </div>


                <div className="mt-6 grid grid-cols-2 gap-3">

                  <button
                    onClick={handleComplete}
                    disabled={actionLoading}
                    className="rounded-xl bg-emerald-400 px-4 py-3 text-sm font-bold text-slate-950 transition hover:bg-emerald-300 disabled:opacity-40"
                  >
                    COMPLETE
                  </button>

                  <button
                    onClick={handleSkip}
                    disabled={actionLoading}
                    className="rounded-xl border border-red-400/20 bg-red-400/5 px-4 py-3 text-sm font-bold text-red-300 transition hover:bg-red-400/10 disabled:opacity-40"
                  >
                    SKIP
                  </button>

                </div>

              </>
            ) : (

              <div className="mt-8 rounded-2xl border border-dashed border-slate-700 bg-slate-900/30 p-7 text-center">

                <div className="text-3xl">
                  —
                </div>

                <p className="mt-3 text-sm text-slate-400">
                  No student is currently being served.
                </p>

              </div>

            )}

          </div>

        </section>


        {/* ===================================================
            QUEUE STATUS CONTROLS
        =================================================== */}

        <section className="mt-6 rounded-3xl border border-white/[0.06] bg-[#0b1628] p-7">

          <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">

            <div>

              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                Service Availability
              </p>

              <h2 className="mt-2 text-xl font-bold">
                Control Queue Status
              </h2>

            </div>


            <div className="flex flex-wrap gap-3">

              <button
                onClick={() =>
                  handleQueueStatus("OPEN")
                }
                disabled={
                  actionLoading ||
                  queue?.status === "OPEN"
                }
                className="rounded-xl border border-emerald-400/20 bg-emerald-400/5 px-5 py-3 text-sm font-semibold text-emerald-300 transition hover:bg-emerald-400/10 disabled:cursor-not-allowed disabled:opacity-30"
              >
                OPEN
              </button>


              <button
                onClick={() =>
                  handleQueueStatus("PAUSED")
                }
                disabled={
                  actionLoading ||
                  queue?.status === "PAUSED"
                }
                className="rounded-xl border border-amber-400/20 bg-amber-400/5 px-5 py-3 text-sm font-semibold text-amber-300 transition hover:bg-amber-400/10 disabled:cursor-not-allowed disabled:opacity-30"
              >
                PAUSE
              </button>


              <button
                onClick={() =>
                  handleQueueStatus("CLOSED")
                }
                disabled={
                  actionLoading ||
                  queue?.status === "CLOSED"
                }
                className="rounded-xl border border-red-400/20 bg-red-400/5 px-5 py-3 text-sm font-semibold text-red-300 transition hover:bg-red-400/10 disabled:cursor-not-allowed disabled:opacity-30"
              >
                CLOSE
              </button>

            </div>

          </div>

        </section>


        {/* ===================================================
            WAITING QUEUE
        =================================================== */}

        <section className="mt-6 overflow-hidden rounded-3xl border border-white/[0.06] bg-[#0b1628]">

          <div className="border-b border-white/[0.06] px-7 py-6">

            <div className="flex items-center justify-between">

              <div>

                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                  Live Queue
                </p>

                <h2 className="mt-2 text-xl font-bold">
                  Waiting Students
                </h2>

              </div>

              <div className="rounded-full border border-cyan-400/20 bg-cyan-400/5 px-3 py-1.5 text-xs font-semibold text-cyan-300">
                {waitingEntries.length} waiting
              </div>

            </div>

          </div>


          {waitingEntries.length === 0 ? (

            <div className="px-7 py-14 text-center">

              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-slate-700 bg-slate-900/50 text-2xl text-slate-500">
                ✓
              </div>

              <h3 className="mt-4 font-semibold">
                No students waiting
              </h3>

              <p className="mt-2 text-sm text-slate-500">
                The queue is currently clear.
              </p>

            </div>

          ) : (

            <div className="divide-y divide-white/[0.05]">

              {waitingEntries.map(
                (entry, index) => (

                  <div
                    key={entry.id}
                    className="flex flex-col gap-4 px-7 py-5 sm:flex-row sm:items-center sm:justify-between"
                  >

                    <div className="flex items-center gap-4">

                      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-900 text-xs font-bold text-slate-500">
                        {index + 1}
                      </div>

                      <div>

                        <div className="flex items-center gap-3">

                          <span className="text-lg font-bold text-cyan-300">
                            {entry.queueCode}
                          </span>

                          <span className="rounded-full border border-amber-400/20 bg-amber-400/5 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-amber-300">
                            Waiting
                          </span>

                        </div>

                        <p className="mt-1 text-xs text-slate-500">
                          Queue #{entry.queueNumber}
                        </p>

                      </div>

                    </div>


                    <div className="text-left sm:text-right">

                      <p className="text-xs text-slate-500">
                        Joined
                      </p>

                      <p className="mt-1 text-sm text-slate-300">
                        {formatTime(
                          entry.joinedAt
                        )}
                      </p>

                    </div>

                  </div>

                )
              )}

            </div>

          )}

        </section>


        {/* ===================================================
            STATISTICS
        =================================================== */}

        <section className="mt-6 grid gap-4 sm:grid-cols-3">

          <div className="rounded-2xl border border-white/[0.06] bg-[#0b1628] p-6">

            <p className="text-xs uppercase tracking-[0.15em] text-slate-500">
              Total Entries
            </p>

            <p className="mt-3 text-3xl font-bold">
              {entries.length}
            </p>

          </div>


          <div className="rounded-2xl border border-white/[0.06] bg-[#0b1628] p-6">

            <p className="text-xs uppercase tracking-[0.15em] text-slate-500">
              Completed
            </p>

            <p className="mt-3 text-3xl font-bold text-emerald-300">
              {completedEntries.length}
            </p>

          </div>


          <div className="rounded-2xl border border-white/[0.06] bg-[#0b1628] p-6">

            <p className="text-xs uppercase tracking-[0.15em] text-slate-500">
              Skipped
            </p>

            <p className="mt-3 text-3xl font-bold text-red-300">
              {skippedEntries.length}
            </p>

          </div>

        </section>


        {/* ===================================================
            FOOTER
        =================================================== */}

        <footer className="mt-12 border-t border-white/[0.06] pt-6">

          <div className="flex flex-col gap-2 text-xs text-slate-600 sm:flex-row sm:items-center sm:justify-between">

            <p>
              QueueX • Staff Control Center
            </p>

            <p>
              {authUser?.email}
            </p>

          </div>

        </footer>

      </div>

    </main>
  );
}