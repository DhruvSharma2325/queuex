"use client";

import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, signOut, User } from "firebase/auth";
import {
  collection,
  doc,
  onSnapshot,
} from "firebase/firestore";
import Link from "next/link";

import { auth } from "@/lib/firebase/auth";
import { db } from "@/lib/firebase/firestore";
import { joinQueue } from "@/lib/firebase/queue/joinQueue";

type ServiceStatus = "OPEN" | "PAUSED" | "CLOSED";

type CampusService = {
  id: string;
  icon: string;
  name: string;
  description: string;
  category: string;
  status: ServiceStatus;
  averageServiceTime: number;
};

type QueueData = {
  serviceId: string;
  currentNumber: number;
  nextNumber: number;
  waitingCount: number;
  status: ServiceStatus;
};

type QueueEntry = {
  id: string;
  userId: string;
  serviceId: string;
  queueNumber: number;
  queueCode: string;
  status:
    | "WAITING"
    | "SERVING"
    | "COMPLETED"
    | "CANCELLED";
};

export default function DashboardPage() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [loggingOut, setLoggingOut] = useState(false);

  const [services, setServices] = useState<CampusService[]>([]);
  const [servicesLoading, setServicesLoading] = useState(true);
  const [servicesError, setServicesError] = useState("");

  const [queueData, setQueueData] = useState<
    Record<string, QueueData>
  >({});

  const [activeQueue, setActiveQueue] =
    useState<QueueEntry | null>(null);

  const [activeQueueLoading, setActiveQueueLoading] =
    useState(true);

  const [joiningServiceId, setJoiningServiceId] =
    useState<string | null>(null);

  const [actionMessage, setActionMessage] =
    useState("");

  const [actionError, setActionError] = useState("");

  /*
   * ---------------------------------------------------------
   * AUTHENTICATION
   * ---------------------------------------------------------
   */

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(
      auth,
      (currentUser) => {
        setUser(currentUser);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, []);

  /*
   * ---------------------------------------------------------
   * LOAD CAMPUS SERVICES
   * ---------------------------------------------------------
   */

  useEffect(() => {
    const servicesRef = collection(db, "services");

    const unsubscribe = onSnapshot(
      servicesRef,
      (snapshot) => {
        const loadedServices: CampusService[] =
          snapshot.docs.map((document) => {
            const data = document.data();

            return {
              id: document.id,
              icon: data.icon || "🏫",
              name: data.name || "Unnamed Service",
              description:
                data.description || "Campus service",
              category: data.category || "Campus",
              status: data.status || "CLOSED",
              averageServiceTime:
                typeof data.averageServiceTime === "number"
                  ? data.averageServiceTime
                  : 0,
            };
          });

        setServices(loadedServices);
        setServicesError("");
        setServicesLoading(false);
      },
      (error) => {
        console.error(
          "Failed to load services:",
          error
        );

        setServicesError(
          "Unable to load campus services right now."
        );

        setServicesLoading(false);
      }
    );

    return () => unsubscribe();
  }, []);

  /*
   * ---------------------------------------------------------
   * REAL-TIME QUEUE DATA
   * ---------------------------------------------------------
   */

  useEffect(() => {
    if (services.length === 0) {
      setQueueData({});
      return;
    }

    const unsubscribers = services.map((service) => {
      const queueRef = doc(
        db,
        "queues",
        service.id
      );

      return onSnapshot(
        queueRef,
        (snapshot) => {
          if (!snapshot.exists()) {
            setQueueData((previous) => {
              const next = { ...previous };
              delete next[service.id];
              return next;
            });

            return;
          }

          const data = snapshot.data();

          const queue: QueueData = {
            serviceId:
              data.serviceId || service.id,

            currentNumber:
              typeof data.currentNumber === "number"
                ? data.currentNumber
                : 0,

            nextNumber:
              typeof data.nextNumber === "number"
                ? data.nextNumber
                : 1,

            waitingCount:
              typeof data.waitingCount === "number"
                ? data.waitingCount
                : 0,

            status:
              data.status || "CLOSED",
          };

          setQueueData((previous) => ({
            ...previous,
            [service.id]: queue,
          }));
        },
        (error) => {
          console.error(
            `Failed to load queue for ${service.id}:`,
            error
          );
        }
      );
    });

    return () => {
      unsubscribers.forEach((unsubscribe) =>
        unsubscribe()
      );
    };
  }, [services]);

  /*
   * ---------------------------------------------------------
   * REAL-TIME CURRENT USER QUEUE
   *
   * We listen directly to:
   *
   * queueEntries/{userId}_{serviceId}
   *
   * This matches joinQueue.ts and the current
   * Firestore security rules.
   * ---------------------------------------------------------
   */

  useEffect(() => {
    if (!user) {
      setActiveQueue(null);
      setActiveQueueLoading(false);
      return;
    }

    if (services.length === 0) {
      setActiveQueue(null);
      setActiveQueueLoading(false);
      return;
    }

    setActiveQueueLoading(true);

    const entriesByService: Record<
      string,
      QueueEntry
    > = {};

    let receivedSnapshots = 0;

    const updateActiveQueue = () => {
      const activeEntries =
        Object.values(entriesByService).filter(
          (entry) =>
            entry.status === "WAITING" ||
            entry.status === "SERVING"
        );

      const nextActiveQueue =
        activeEntries.length > 0
          ? activeEntries[0]
          : null;

      setActiveQueue(nextActiveQueue);
    };

    const unsubscribers = services.map((service) => {
      const entryId =
        `${user.uid}_${service.id}`;

      const entryRef = doc(
        db,
        "queueEntries",
        entryId
      );

      return onSnapshot(
        entryRef,
        (snapshot) => {
          if (!snapshot.exists()) {
            delete entriesByService[service.id];
          } else {
            const data = snapshot.data();

            const entry: QueueEntry = {
              id: snapshot.id,

              userId:
                data.userId || user.uid,

              serviceId:
                data.serviceId || service.id,

              queueNumber:
                typeof data.queueNumber === "number"
                  ? data.queueNumber
                  : 0,

              queueCode:
                data.queueCode || "QUEUE",

              status:
                data.status || "WAITING",
            };

            entriesByService[service.id] = entry;
          }

          receivedSnapshots += 1;

          updateActiveQueue();

          if (
            receivedSnapshots >= services.length
          ) {
            setActiveQueueLoading(false);
          }
        },
        (error) => {
          console.error(
            `Failed to load queue entry for ${service.id}:`,
            error
          );

          delete entriesByService[service.id];

          receivedSnapshots += 1;

          updateActiveQueue();

          if (
            receivedSnapshots >= services.length
          ) {
            setActiveQueueLoading(false);
          }
        }
      );
    });

    const timeout = window.setTimeout(() => {
      setActiveQueueLoading(false);
    }, 1500);

    return () => {
      window.clearTimeout(timeout);

      unsubscribers.forEach((unsubscribe) =>
        unsubscribe()
      );
    };
  }, [user, services]);

  /*
   * ---------------------------------------------------------
   * LOGOUT
   * ---------------------------------------------------------
   */

  const handleLogout = async () => {
    try {
      setLoggingOut(true);

      await signOut(auth);

      window.location.href = "/";
    } catch (error) {
      console.error(
        "Logout failed:",
        error
      );

      setLoggingOut(false);
    }
  };

  /*
   * ---------------------------------------------------------
   * JOIN QUEUE
   * ---------------------------------------------------------
   */

  const handleJoinQueue = async (
    serviceId: string
  ) => {
    if (!user) {
      window.location.href = "/login";
      return;
    }

    setActionMessage("");
    setActionError("");

    /*
     * QueueX currently allows one active queue
     * per student.
     */

    if (activeQueue) {
      if (
        activeQueue.serviceId === serviceId
      ) {
        setActionMessage(
          `You're already in this queue as ${activeQueue.queueCode}.`
        );
      } else {
        const activeService =
          services.find(
            (service) =>
              service.id ===
              activeQueue.serviceId
          );

        setActionError(
          `You already have an active queue${
            activeService
              ? ` at ${activeService.name}`
              : ""
          }. Please finish that queue before joining another.`
        );
      }

      return;
    }

    const service = services.find(
      (item) => item.id === serviceId
    );

    if (!service) {
      setActionError(
        "This campus service could not be found."
      );

      return;
    }

    if (service.status !== "OPEN") {
      setActionError(
        "This service is currently unavailable."
      );

      return;
    }

    const queue = queueData[serviceId];

    if (!queue) {
      setActionError(
        "This service does not have an active queue yet."
      );

      return;
    }

    if (queue.status !== "OPEN") {
      setActionError(
        "This queue is currently unavailable."
      );

      return;
    }

    try {
      setJoiningServiceId(serviceId);

      const result = await joinQueue(
        user.uid,
        serviceId
      );

      if (result.alreadyJoined) {
        setActionMessage(
          `You're already in the queue as ${result.queueCode}.`
        );
      } else {
        setActionMessage(
          `You're in! Your queue number is ${result.queueCode}.`
        );
      }
    } catch (error) {
      console.error(
        "Join queue failed:",
        error
      );

      if (error instanceof Error) {
        setActionError(error.message);
      } else {
        setActionError(
          "Unable to join the queue right now."
        );
      }
    } finally {
      setJoiningServiceId(null);
    }
  };

  /*
   * ---------------------------------------------------------
   * DERIVED ACTIVE QUEUE INFORMATION
   * ---------------------------------------------------------
   */

  const activeService = useMemo(() => {
    if (!activeQueue) {
      return null;
    }

    return (
      services.find(
        (service) =>
          service.id ===
          activeQueue.serviceId
      ) || null
    );
  }, [activeQueue, services]);

  const activeQueueData = useMemo(() => {
    if (!activeQueue) {
      return null;
    }

    return (
      queueData[
        activeQueue.serviceId
      ] || null
    );
  }, [activeQueue, queueData]);

  /*
   * Current token being served.
   */

  const currentServingNumber =
    activeQueueData?.currentNumber || 0;

  const currentServingCode =
    currentServingNumber > 0
      ? `A-${String(
          currentServingNumber
        ).padStart(3, "0")}`
      : "Not started";

  /*
   * People ahead of the student.
   *
   * If the student is waiting:
   *
   * token 31
   * current 28
   *
   * 29 and 30 are ahead = 2 people.
   *
   * If the student's token is currently being served,
   * there are 0 people ahead.
   */

  const peopleAhead = useMemo(() => {
    if (!activeQueue || !activeQueueData) {
      return 0;
    }

    if (
      activeQueue.status === "SERVING"
    ) {
      return 0;
    }

    return Math.max(
      0,
      activeQueue.queueNumber -
        activeQueueData.currentNumber -
        1
    );
  }, [activeQueue, activeQueueData]);

  /*
   * Position in line.
   *
   * Waiting:
   *   people ahead + 1
   *
   * Serving:
   *   1
   */

  const queuePosition = activeQueue
    ? activeQueue.status === "SERVING"
      ? 1
      : peopleAhead + 1
    : 0;

  /*
   * Estimated waiting time.
   *
   * Once the student's token is being served,
   * estimated wait becomes 0.
   */

  const activeEstimatedWait =
    activeService &&
    activeQueue?.status === "WAITING"
      ? peopleAhead *
        activeService.averageServiceTime
      : 0;

  /*
   * Queue progress.
   *
   * This represents how far the current queue
   * has progressed toward the student's token.
   */

  const queueProgress = useMemo(() => {
    if (!activeQueue || !activeQueueData) {
      return 0;
    }

    if (
      activeQueue.status === "SERVING"
    ) {
      return 100;
    }

    if (
      activeQueue.queueNumber <= 0
    ) {
      return 0;
    }

    const progress =
      (activeQueueData.currentNumber /
        activeQueue.queueNumber) *
      100;

    return Math.min(
      95,
      Math.max(5, Math.round(progress))
    );
  }, [activeQueue, activeQueueData]);

  /*
   * Human-readable queue state.
   */

  const activeQueueState =
    activeQueue?.status === "SERVING"
      ? "YOUR TURN"
      : activeQueue?.status === "WAITING"
        ? "WAITING"
        : "";

  /*
   * Service helpers
   */

  const getStatusLabel = (
    status: ServiceStatus
  ) => {
    if (status === "OPEN") {
      return "Open";
    }

    if (status === "PAUSED") {
      return "Paused";
    }

    return "Closed";
  };

  const getStatusClasses = (
    status: ServiceStatus
  ) => {
    if (status === "OPEN") {
      return "bg-emerald-400/10 text-emerald-400";
    }

    if (status === "PAUSED") {
      return "bg-amber-400/10 text-amber-400";
    }

    return "bg-red-400/10 text-red-400";
  };

  /*
   * Dynamic dashboard statistics.
   */

  const totalWaiting =
    services.reduce(
      (total, service) =>
        total +
        (queueData[service.id]
          ?.waitingCount || 0),
      0
    );

  const openServices =
    services.filter(
      (service) =>
        service.status === "OPEN" &&
        queueData[service.id]?.status ===
          "OPEN"
    ).length;

  /*
   * ---------------------------------------------------------
   * LOADING SCREEN
   * ---------------------------------------------------------
   */

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#020817] text-white">
        <div className="text-center">
          <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-4 border-slate-700 border-t-cyan-400" />

          <p className="text-slate-400">
            Loading your dashboard...
          </p>
        </div>
      </main>
    );
  }

  /*
   * ---------------------------------------------------------
   * NOT LOGGED IN
   * ---------------------------------------------------------
   */

  if (!user) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#020817] px-6 text-white">
        <div className="text-center">
          <h1 className="text-3xl font-bold">
            Please log in
          </h1>

          <p className="mt-3 text-slate-400">
            You need to be logged in to access
            your dashboard.
          </p>

          <Link
            href="/login"
            className="mt-6 inline-block rounded-lg bg-cyan-400 px-6 py-3 font-semibold text-slate-950 transition hover:bg-cyan-300"
          >
            Go to Login
          </Link>
        </div>
      </main>
    );
  }

  const displayName =
    user.displayName ||
    user.email?.split("@")[0] ||
    "QueueX Student";

  /*
   * ---------------------------------------------------------
   * MAIN DASHBOARD
   * ---------------------------------------------------------
   */

  return (
    <main className="min-h-screen bg-[#020817] text-white">
      {/* Navigation */}

      <nav className="border-b border-white/10 bg-[#020817]/95">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
          <Link
            href="/"
            className="flex items-center gap-3"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-400 text-lg font-bold text-slate-950">
              Q
            </div>

            <div>
              <h1 className="text-xl font-bold tracking-tight">
                QueueX
              </h1>

              <p className="text-xs text-cyan-400">
                Smart Campus Queues
              </p>
            </div>
          </Link>

          <div className="flex items-center gap-3 md:gap-6">
            <Link
              href="/"
              className="hidden text-sm text-slate-300 transition hover:text-white md:block"
            >
              Home
            </Link>

            <Link
              href="/dashboard"
              className="hidden text-sm text-cyan-400 md:block"
            >
              Dashboard
            </Link>

            <button
              type="button"
              onClick={handleLogout}
              disabled={loggingOut}
              className="rounded-lg border border-slate-700 bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:border-slate-500 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loggingOut
                ? "Logging out..."
                : "Logout"}
            </button>
          </div>
        </div>
      </nav>

      {/* Main Content */}

      <div className="mx-auto max-w-7xl px-6 py-10">
        {/* Welcome */}

        <section className="mb-10">
          <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/5 px-4 py-2 text-sm text-cyan-400">
            <span className="h-2 w-2 rounded-full bg-emerald-400" />

            Student Dashboard
          </div>

          <h1 className="mt-5 text-4xl font-bold tracking-tight md:text-5xl">
            Welcome,{" "}
            <span className="text-cyan-400">
              {displayName}
            </span>
          </h1>

          <p className="mt-3 max-w-2xl text-slate-400">
            Find a campus service, join a queue,
            and track your position in real time.
          </p>
        </section>

        {/* Action Messages */}

        {(actionMessage ||
          actionError) && (
          <section className="mb-8 space-y-3">
            {actionMessage && (
              <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/5 px-5 py-4 text-sm text-emerald-300">
                {actionMessage}
              </div>
            )}

            {actionError && (
              <div className="rounded-2xl border border-red-400/20 bg-red-400/5 px-5 py-4 text-sm text-red-300">
                {actionError}
              </div>
            )}
          </section>
        )}

        {/* Active Queue */}

        <section className="mb-10">
          <div className="mb-5">
            <h2 className="text-2xl font-bold">
              Your Active Queue
            </h2>

            <p className="mt-1 text-sm text-slate-500">
              Your queue status updates automatically
              in real time.
            </p>
          </div>

          {activeQueueLoading ? (
            <div className="animate-pulse rounded-2xl border border-slate-800 bg-[#0b1728] p-6">
              <div className="h-5 w-32 rounded bg-slate-800" />

              <div className="mt-4 h-10 w-48 rounded bg-slate-800" />

              <div className="mt-6 grid gap-4 md:grid-cols-4">
                <div className="h-24 rounded-xl bg-slate-900" />
                <div className="h-24 rounded-xl bg-slate-900" />
                <div className="h-24 rounded-xl bg-slate-900" />
                <div className="h-24 rounded-xl bg-slate-900" />
              </div>
            </div>
          ) : activeQueue ? (
            <div className="overflow-hidden rounded-2xl border border-cyan-400/20 bg-[#0b1728] shadow-2xl shadow-cyan-950/20">
              {/* Queue Header */}

              <div className="border-b border-slate-800 p-6">
                <div className="flex flex-col justify-between gap-5 md:flex-row md:items-center">
                  <div>
                    <div className="flex flex-wrap items-center gap-3">
                      <p className="text-sm text-cyan-400">
                        {activeQueue.status ===
                        "SERVING"
                          ? "It's your turn"
                          : "You're in the queue"}
                      </p>

                      <span
                        className={`rounded-full px-3 py-1 text-xs font-semibold ${
                          activeQueue.status ===
                          "SERVING"
                            ? "bg-cyan-400/10 text-cyan-300"
                            : "bg-amber-400/10 text-amber-300"
                        }`}
                      >
                        {activeQueueState}
                      </span>
                    </div>

                    <h3 className="mt-2 text-2xl font-bold">
                      {activeService?.name ||
                        "Campus Service"}
                    </h3>

                    <p className="mt-1 text-sm text-slate-400">
                      {activeService?.category ||
                        "Campus service"}
                    </p>
                  </div>

                  {/* Token */}

                  <div className="rounded-2xl border border-cyan-400/20 bg-cyan-400/10 px-7 py-5 text-center">
                    <p className="text-xs uppercase tracking-widest text-cyan-400">
                      Your Number
                    </p>

                    <p className="mt-1 text-4xl font-black tracking-tight">
                      {activeQueue.queueCode}
                    </p>
                  </div>
                </div>
              </div>

              {/* Main Queue Information */}

              <div className="grid gap-4 p-6 sm:grid-cols-2 lg:grid-cols-4">
                {/* Current Serving */}

                <div className="rounded-xl bg-slate-900/80 p-5">
                  <p className="text-sm text-slate-500">
                    Now Serving
                  </p>

                  <p className="mt-2 text-3xl font-bold">
                    {currentServingCode}
                  </p>

                  <p className="mt-1 text-xs text-slate-500">
                    Current token
                  </p>
                </div>

                {/* People Ahead */}

                <div className="rounded-xl bg-slate-900/80 p-5">
                  <p className="text-sm text-slate-500">
                    People Ahead
                  </p>

                  <p className="mt-2 text-3xl font-bold">
                    {peopleAhead}
                  </p>

                  <p className="mt-1 text-xs text-slate-500">
                    Before your turn
                  </p>
                </div>

                {/* Position */}

                <div className="rounded-xl bg-slate-900/80 p-5">
                  <p className="text-sm text-slate-500">
                    Your Position
                  </p>

                  <p className="mt-2 text-3xl font-bold">
                    #{queuePosition}
                  </p>

                  <p className="mt-1 text-xs text-slate-500">
                    In this queue
                  </p>
                </div>

                {/* Estimated Wait */}

                <div className="rounded-xl bg-cyan-400/10 p-5">
                  <p className="text-sm text-cyan-400">
                    Estimated Wait
                  </p>

                  <p className="mt-2 text-3xl font-bold">
                    {activeQueue.status ===
                    "SERVING"
                      ? "Now"
                      : `${activeEstimatedWait} min`}
                  </p>

                  <p className="mt-1 text-xs text-slate-500">
                    Approximate
                  </p>
                </div>
              </div>

              {/* Progress */}

              <div className="border-t border-slate-800 px-6 py-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-slate-300">
                      Queue Progress
                    </p>

                    <p className="mt-1 text-xs text-slate-500">
                      {activeQueue.status ===
                      "SERVING"
                        ? "Your token is being served."
                        : `${peopleAhead} ${
                            peopleAhead === 1
                              ? "person"
                              : "people"
                          } ahead of you.`}
                    </p>
                  </div>

                  <span className="text-sm font-semibold text-cyan-400">
                    {queueProgress}%
                  </span>
                </div>

                <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-800">
                  <div
                    className="h-full rounded-full bg-cyan-400 transition-all duration-700"
                    style={{
                      width: `${queueProgress}%`,
                    }}
                  />
                </div>
              </div>

              {/* Queue Status */}

              <div className="border-t border-slate-800 px-6 py-4">
                {activeQueueData?.status ===
                "PAUSED" ? (
                  <div className="flex items-center gap-3 text-sm text-amber-300">
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-amber-400/10">
                      ⏸
                    </span>

                    <div>
                      <p className="font-medium">
                        Queue temporarily paused
                      </p>

                      <p className="text-xs text-slate-500">
                        Your position is preserved.
                      </p>
                    </div>
                  </div>
                ) : activeQueueData?.status ===
                  "CLOSED" ? (
                  <div className="flex items-center gap-3 text-sm text-red-300">
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-red-400/10">
                      !
                    </span>

                    <div>
                      <p className="font-medium">
                        Queue is currently closed
                      </p>

                      <p className="text-xs text-slate-500">
                        Please wait for the service
                        to reopen.
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-sm text-emerald-400">
                    <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />

                    Live queue tracking active
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-slate-800 bg-[#0b1728] p-6">
              <div className="flex flex-col items-start justify-between gap-6 md:flex-row md:items-center">
                <div>
                  <p className="text-sm text-slate-500">
                    No active queue
                  </p>

                  <h3 className="mt-2 text-xl font-semibold text-slate-200">
                    You haven't joined a queue yet.
                  </h3>

                  <p className="mt-2 text-sm text-slate-400">
                    Choose a campus service below
                    to get started.
                  </p>
                </div>

                <a
                  href="#services"
                  className="rounded-lg bg-cyan-400 px-5 py-3 font-semibold text-slate-950 transition hover:bg-cyan-300"
                >
                  Find a Service →
                </a>
              </div>
            </div>
          )}
        </section>

        {/* Campus Services */}

        <section id="services">
          <div className="mb-5">
            <h2 className="text-2xl font-bold">
              Campus Services
            </h2>

            <p className="mt-1 text-sm text-slate-500">
              Select a service and join its queue.
            </p>
          </div>

          {servicesLoading ? (
            <div className="grid gap-5 md:grid-cols-2">
              {[1, 2].map((item) => (
                <div
                  key={item}
                  className="animate-pulse rounded-2xl border border-slate-800 bg-[#0b1728] p-6"
                >
                  <div className="h-12 w-12 rounded-xl bg-slate-800" />

                  <div className="mt-5 h-6 w-48 rounded bg-slate-800" />

                  <div className="mt-3 h-4 w-full rounded bg-slate-800" />

                  <div className="mt-2 h-4 w-3/4 rounded bg-slate-800" />

                  <div className="mt-7 h-px bg-slate-800" />

                  <div className="mt-5 h-10 rounded bg-slate-800" />
                </div>
              ))}
            </div>
          ) : servicesError ? (
            <div className="rounded-2xl border border-red-400/20 bg-red-400/5 p-6 text-sm text-red-300">
              {servicesError}
            </div>
          ) : services.length === 0 ? (
            <div className="rounded-2xl border border-slate-800 bg-[#0b1728] p-8 text-center">
              <div className="text-4xl">
                🏫
              </div>

              <h3 className="mt-4 text-xl font-semibold">
                No campus services available
              </h3>

              <p className="mt-2 text-sm text-slate-400">
                Services added by QueueX staff
                will appear here.
              </p>
            </div>
          ) : (
            <div className="grid gap-5 md:grid-cols-2">
              {services.map((service) => {
                const queue =
                  queueData[service.id];

                const isJoining =
                  joiningServiceId ===
                  service.id;

                const isUnavailable =
                  service.status !== "OPEN" ||
                  !queue ||
                  queue.status !== "OPEN";

                const currentCode =
                  queue &&
                  queue.currentNumber > 0
                    ? `A-${String(
                        queue.currentNumber
                      ).padStart(3, "0")}`
                    : "Not started";

                const estimatedQueueWait =
                  queue &&
                  queue.waitingCount > 0
                    ? queue.waitingCount *
                      service.averageServiceTime
                    : 0;

                return (
                  <div
                    key={service.id}
                    className="group rounded-2xl border border-slate-800 bg-[#0b1728] p-6 transition hover:-translate-y-1 hover:border-cyan-400/30 hover:bg-[#0d1b2f]"
                  >
                    {/* Service Header */}

                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-start gap-4">
                        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-2xl">
                          {service.icon}
                        </div>

                        <div>
                          <h3 className="text-lg font-semibold">
                            {service.name}
                          </h3>

                          <p className="mt-1 text-sm leading-6 text-slate-400">
                            {service.description}
                          </p>
                        </div>
                      </div>

                      <span
                        className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium ${getStatusClasses(
                          service.status
                        )}`}
                      >
                        {getStatusLabel(
                          service.status
                        )}
                      </span>
                    </div>

                    {/* Service Stats */}

                    <div className="mt-6 grid grid-cols-2 gap-3">
                      <div className="rounded-xl bg-slate-900/70 p-4">
                        <p className="text-xs text-slate-500">
                          People waiting
                        </p>

                        <p className="mt-1 text-lg font-bold">
                          {queue?.waitingCount ??
                            0}
                        </p>
                      </div>

                      <div className="rounded-xl bg-slate-900/70 p-4">
                        <p className="text-xs text-slate-500">
                          Avg. service time
                        </p>

                        <p className="mt-1 text-lg font-bold">
                          {
                            service.averageServiceTime
                          }{" "}
                          min
                        </p>
                      </div>
                    </div>

                    {/* Current Queue */}

                    <div className="mt-3 grid grid-cols-2 gap-3">
                      <div className="rounded-xl bg-slate-900/70 p-4">
                        <p className="text-xs text-slate-500">
                          Now serving
                        </p>

                        <p className="mt-1 text-lg font-bold">
                          {currentCode}
                        </p>
                      </div>

                      <div className="rounded-xl bg-cyan-400/5 p-4">
                        <p className="text-xs text-cyan-400">
                          Est. queue wait
                        </p>

                        <p className="mt-1 text-lg font-bold">
                          {estimatedQueueWait} min
                        </p>
                      </div>
                    </div>

                    {/* Join */}

                    <div className="mt-5 flex items-center justify-between border-t border-slate-800 pt-5">
                      <div>
                        <p className="text-xs text-slate-500">
                          Queue status
                        </p>

                        <p
                          className={`mt-1 text-sm font-medium ${
                            queue?.status ===
                            "OPEN"
                              ? "text-emerald-400"
                              : "text-slate-400"
                          }`}
                        >
                          {queue
                            ? getStatusLabel(
                                queue.status
                              )
                            : "Not available"}
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={() =>
                          handleJoinQueue(
                            service.id
                          )
                        }
                        disabled={
                          isJoining ||
                          isUnavailable ||
                          !!activeQueue
                        }
                        className="rounded-lg bg-cyan-400 px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-500"
                      >
                        {isJoining
                          ? "Joining..."
                          : activeQueue
                            ? "Queue Active"
                            : isUnavailable
                              ? "Unavailable"
                              : "Join Queue"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Dashboard Statistics */}

        <section className="mt-10 grid gap-5 sm:grid-cols-3">
          <div className="rounded-2xl border border-slate-800 bg-[#0b1728] p-6">
            <p className="text-sm text-slate-500">
              Active Queue
            </p>

            <p className="mt-2 text-3xl font-bold">
              {activeQueue ? "1" : "0"}
            </p>

            <p className="mt-1 text-xs text-slate-600">
              Your current queue
            </p>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-[#0b1728] p-6">
            <p className="text-sm text-slate-500">
              People Waiting
            </p>

            <p className="mt-2 text-3xl font-bold">
              {activeQueue
                ? peopleAhead
                : totalWaiting}
            </p>

            <p className="mt-1 text-xs text-slate-600">
              {activeQueue
                ? "Ahead of you"
                : "Across campus services"}
            </p>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-[#0b1728] p-6">
            <p className="text-sm text-slate-500">
              Open Services
            </p>

            <p className="mt-2 text-3xl font-bold text-cyan-400">
              {openServices}
            </p>

            <p className="mt-1 text-xs text-slate-600">
              Ready to accept queues
            </p>
          </div>
        </section>

        {/* Footer */}

        <footer className="mt-14 border-t border-slate-800 py-8 text-center">
          <p className="text-sm text-slate-600">
            QueueX • Smart Campus Queues
          </p>

          <p className="mt-1 text-xs text-slate-700">
            Real-time queue management for campus
            services.
          </p>
        </footer>
      </div>
    </main>
  );
}