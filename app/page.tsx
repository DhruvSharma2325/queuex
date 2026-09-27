"use client";

import { useEffect, useState } from "react";
import { onAuthStateChanged, signOut, User } from "firebase/auth";
import {
  collection,
  getDocs,
} from "firebase/firestore";
import { auth } from "@/lib/firebase/auth";
import { db } from "@/lib/firebase/firestore";

type FirestoreService = {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: string;
  status: "OPEN" | "PAUSED" | "CLOSED";
  averageServiceTime: number;
};

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  const [services, setServices] = useState<FirestoreService[]>([]);
  const [servicesLoading, setServicesLoading] = useState(true);
  const [servicesError, setServicesError] = useState("");

  const [loggingOut, setLoggingOut] = useState(false);

  // Authentication state
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(
      auth,
      (currentUser) => {
        setUser(currentUser);
        setAuthLoading(false);
      }
    );

    return () => unsubscribe();
  }, []);

  // Load campus services from Firestore
  useEffect(() => {
    const loadServices = async () => {
      try {
        setServicesLoading(true);
        setServicesError("");

        const snapshot = await getDocs(
          collection(db, "services")
        );

        const loadedServices: FirestoreService[] =
          snapshot.docs.map((document) => {
            const data = document.data();

            return {
              id: document.id,
              name: data.name || "Unnamed Service",
              description:
                data.description ||
                "Campus service information",
              icon: data.icon || "🏫",
              category: data.category || "Campus",
              status: data.status || "CLOSED",
              averageServiceTime:
                typeof data.averageServiceTime === "number"
                  ? data.averageServiceTime
                  : 0,
            };
          });

        setServices(loadedServices);
      } catch (error) {
        console.error(
          "Failed to load services:",
          error
        );

        setServicesError(
          "Unable to load campus services right now."
        );
      } finally {
        setServicesLoading(false);
      }
    };

    loadServices();
  }, []);

  const handleLogout = async () => {
    try {
      setLoggingOut(true);
      await signOut(auth);
    } catch (error) {
      console.error("Logout failed:", error);
    } finally {
      setLoggingOut(false);
    }
  };

  const displayName =
    user?.displayName?.trim() ||
    user?.email?.split("@")[0] ||
    "Student";

  const getStatusLabel = (
    status: FirestoreService["status"]
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
    status: FirestoreService["status"]
  ) => {
    if (status === "OPEN") {
      return "bg-emerald-400/10 text-emerald-400";
    }

    if (status === "PAUSED") {
      return "bg-amber-400/10 text-amber-400";
    }

    return "bg-red-400/10 text-red-400";
  };

  const getStatusDotClasses = (
    status: FirestoreService["status"]
  ) => {
    if (status === "OPEN") {
      return "bg-emerald-400";
    }

    if (status === "PAUSED") {
      return "bg-amber-400";
    }

    return "bg-red-400";
  };

  return (
    <main className="min-h-screen bg-[#020617] text-white">
      {/* Navigation */}
      <nav className="border-b border-white/10 bg-[#020617]/90">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
          {/* Logo */}
          <a
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

              <p className="text-xs text-slate-400">
                Smart Campus Queues
              </p>
            </div>
          </a>

          {/* Navigation Links */}
          <div className="hidden items-center gap-8 text-sm text-slate-300 md:flex">
            <a
              href="#services"
              className="transition hover:text-cyan-400"
            >
              Services
            </a>

            <a
              href="#how-it-works"
              className="transition hover:text-cyan-400"
            >
              How It Works
            </a>

            <a
              href="#about"
              className="transition hover:text-cyan-400"
            >
              About
            </a>
          </div>

          {/* Auth Actions */}
          <div className="flex items-center gap-3">
            {authLoading ? (
              <div className="h-10 w-24 animate-pulse rounded-lg bg-slate-800" />
            ) : user ? (
              <>
                <a
                  href="/dashboard"
                  className="hidden rounded-lg px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-slate-800 hover:text-white sm:block"
                >
                  Dashboard
                </a>

                <button
                  type="button"
                  onClick={handleLogout}
                  disabled={loggingOut}
                  className="rounded-lg border border-slate-700 bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:border-red-400/50 hover:bg-red-500/10 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loggingOut
                    ? "Logging out..."
                    : "Logout"}
                </button>
              </>
            ) : (
              <>
                <a
                  href="/login"
                  className="hidden px-3 py-2 text-sm font-medium text-slate-300 transition hover:text-white sm:block"
                >
                  Log In
                </a>

                <a
                  href="/register"
                  className="rounded-lg bg-cyan-400 px-5 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300"
                >
                  Join Queue
                </a>
              </>
            )}
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="relative overflow-hidden">
        {/* Background glow */}
        <div className="pointer-events-none absolute left-1/2 top-20 h-96 w-96 -translate-x-1/2 rounded-full bg-cyan-500/10 blur-3xl" />

        <div className="relative mx-auto max-w-6xl px-6 pb-20 pt-24">
          {/* Logged-in greeting */}
          {user ? (
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/5 px-4 py-2 text-sm text-cyan-300">
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
              Welcome back, {displayName}
            </div>
          ) : (
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/5 px-4 py-2 text-sm text-cyan-300">
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
              Campus queues, made smarter
            </div>
          )}

          <div className="max-w-3xl">
            <h2 className="text-5xl font-bold leading-tight tracking-tight sm:text-6xl lg:text-7xl">
              Skip the line.
              <br />
              <span className="text-cyan-400">
                Not your turn.
              </span>
            </h2>

            <p className="mt-7 max-w-2xl text-lg leading-8 text-slate-400">
              QueueX helps students join campus service
              queues digitally, track their position in
              real time, and know when it is their turn.
            </p>

            <div className="mt-9 flex flex-wrap gap-4">
              <a
                href="#services"
                className="rounded-xl bg-cyan-400 px-6 py-3.5 font-semibold text-slate-950 transition hover:bg-cyan-300"
              >
                Find a Service →
              </a>

              {user ? (
                <a
                  href="/dashboard"
                  className="rounded-xl border border-slate-700 bg-slate-900 px-6 py-3.5 font-semibold text-white transition hover:border-cyan-400/50 hover:bg-slate-800"
                >
                  Go to Dashboard
                </a>
              ) : (
                <a
                  href="/login"
                  className="rounded-xl border border-slate-700 bg-slate-900 px-6 py-3.5 font-semibold text-white transition hover:border-cyan-400/50 hover:bg-slate-800"
                >
                  Staff Portal
                </a>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Live Queue */}
      <section className="mx-auto max-w-6xl px-6 pb-20">
        <div className="rounded-2xl border border-slate-800 bg-[#0b1222] p-6 shadow-2xl">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
            <div>
              <p className="text-sm text-slate-400">
                Live Queue
              </p>

              <h3 className="mt-1 text-2xl font-bold">
                Certificate Office
              </h3>
            </div>

            <div className="flex w-fit items-center gap-2 rounded-full bg-emerald-400/10 px-3 py-1.5 text-sm text-emerald-400">
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
              Open
            </div>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-3">
            <div className="rounded-xl bg-slate-900/80 p-5">
              <p className="text-sm text-slate-400">
                Now Serving
              </p>

              <p className="mt-2 text-3xl font-bold">
                A-024
              </p>
            </div>

            <div className="rounded-xl bg-slate-900/80 p-5">
              <p className="text-sm text-slate-400">
                People Waiting
              </p>

              <p className="mt-2 text-3xl font-bold">
                7
              </p>
            </div>

            <div className="rounded-xl bg-cyan-400/10 p-5">
              <p className="text-sm text-cyan-400">
                Estimated Wait
              </p>

              <p className="mt-2 text-3xl font-bold">
                8 min
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Services */}
      <section
        id="services"
        className="border-t border-white/5 bg-[#050b16]"
      >
        <div className="mx-auto max-w-6xl px-6 py-20">
          <div className="max-w-2xl">
            <p className="text-sm font-medium uppercase tracking-widest text-cyan-400">
              Campus Services
            </p>

            <h2 className="mt-3 text-3xl font-bold sm:text-4xl">
              Find the service you need.
            </h2>

            <p className="mt-4 text-slate-400">
              Check availability and join a queue without
              waiting physically in line.
            </p>
          </div>

          {/* Loading */}
          {servicesLoading && (
            <div className="mt-10 grid gap-5 md:grid-cols-2">
              {[1, 2].map((item) => (
                <div
                  key={item}
                  className="animate-pulse rounded-2xl border border-slate-800 bg-[#0b1222] p-6"
                >
                  <div className="h-12 w-12 rounded-xl bg-slate-800" />

                  <div className="mt-5 h-6 w-48 rounded bg-slate-800" />

                  <div className="mt-3 h-4 w-full rounded bg-slate-800" />

                  <div className="mt-2 h-4 w-3/4 rounded bg-slate-800" />

                  <div className="mt-7 h-px bg-slate-800" />

                  <div className="mt-5 h-10 w-full rounded bg-slate-800" />
                </div>
              ))}
            </div>
          )}

          {/* Error */}
          {!servicesLoading && servicesError && (
            <div className="mt-10 rounded-2xl border border-red-500/20 bg-red-500/5 p-6">
              <p className="text-sm font-medium text-red-300">
                {servicesError}
              </p>

              <p className="mt-2 text-sm text-slate-500">
                Please refresh the page and try again.
              </p>
            </div>
          )}

          {/* Empty */}
          {!servicesLoading &&
            !servicesError &&
            services.length === 0 && (
              <div className="mt-10 rounded-2xl border border-slate-800 bg-[#0b1222] p-8 text-center">
                <div className="text-4xl">🏫</div>

                <h3 className="mt-4 text-xl font-semibold">
                  No services available
                </h3>

                <p className="mt-2 text-sm text-slate-400">
                  Campus services will appear here when
                  they are added.
                </p>
              </div>
            )}

          {/* Services from Firestore */}
          {!servicesLoading &&
            !servicesError &&
            services.length > 0 && (
              <div className="mt-10 grid gap-5 md:grid-cols-2">
                {services.map((service) => (
                  <div
                    key={service.id}
                    className="group rounded-2xl border border-slate-800 bg-[#0b1222] p-6 transition hover:-translate-y-1 hover:border-cyan-400/30"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-slate-900 text-2xl">
                        {service.icon}
                      </div>

                      <span
                        className={`rounded-full px-3 py-1 text-xs font-medium ${getStatusClasses(
                          service.status
                        )}`}
                      >
                        <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-current" />

                        {getStatusLabel(
                          service.status
                        )}
                      </span>
                    </div>

                    <h3 className="mt-5 text-xl font-semibold">
                      {service.name}
                    </h3>

                    <p className="mt-2 text-sm leading-6 text-slate-400">
                      {service.description}
                    </p>

                    <div className="mt-5 flex items-center justify-between border-t border-slate-800 pt-5">
                      <div>
                        <p className="text-xs text-slate-500">
                          Average service time
                        </p>

                        <p className="mt-1 font-medium text-slate-200">
                          {service.averageServiceTime} min
                        </p>
                      </div>

                      <a
                        href={
                          user
                            ? "/dashboard"
                            : "/login"
                        }
                        className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
                          service.status === "OPEN"
                            ? "bg-cyan-400 text-slate-950 hover:bg-cyan-300"
                            : "cursor-not-allowed bg-slate-800 text-slate-500"
                        }`}
                        onClick={(event) => {
                          if (
                            service.status !==
                            "OPEN"
                          ) {
                            event.preventDefault();
                          }
                        }}
                      >
                        {service.status ===
                        "OPEN"
                          ? "Join Queue"
                          : "Unavailable"}
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            )}
        </div>
      </section>

      {/* How It Works */}
      <section id="how-it-works">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <div className="text-center">
            <p className="text-sm font-medium uppercase tracking-widest text-cyan-400">
              How It Works
            </p>

            <h2 className="mt-3 text-3xl font-bold sm:text-4xl">
              Queue in three simple steps.
            </h2>
          </div>

          <div className="mt-12 grid gap-6 md:grid-cols-3">
            <div className="rounded-2xl border border-slate-800 bg-[#0b1222] p-7">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-cyan-400 font-bold text-slate-950">
                1
              </div>

              <h3 className="mt-6 text-xl font-semibold">
                Find a Service
              </h3>

              <p className="mt-3 leading-7 text-slate-400">
                Choose the campus service you need and
                check its current queue status.
              </p>
            </div>

            <div className="rounded-2xl border border-slate-800 bg-[#0b1222] p-7">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-cyan-400 font-bold text-slate-950">
                2
              </div>

              <h3 className="mt-6 text-xl font-semibold">
                Join Digitally
              </h3>

              <p className="mt-3 leading-7 text-slate-400">
                Join the queue from your phone or laptop
                instead of standing in a physical line.
              </p>
            </div>

            <div className="rounded-2xl border border-slate-800 bg-[#0b1222] p-7">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-cyan-400 font-bold text-slate-950">
                3
              </div>

              <h3 className="mt-6 text-xl font-semibold">
                Track Your Turn
              </h3>

              <p className="mt-3 leading-7 text-slate-400">
                Monitor your queue position and arrive when
                your turn is approaching.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* About */}
      <section
        id="about"
        className="border-t border-white/5 bg-[#050b16]"
      >
        <div className="mx-auto max-w-6xl px-6 py-20">
          <div className="grid gap-10 md:grid-cols-2 md:items-center">
            <div>
              <p className="text-sm font-medium uppercase tracking-widest text-cyan-400">
                About QueueX
              </p>

              <h2 className="mt-3 text-3xl font-bold sm:text-4xl">
                Campus queues, without the unnecessary
                waiting.
              </h2>
            </div>

            <p className="leading-8 text-slate-400">
              QueueX is designed to make everyday campus
              services more convenient by moving queue
              management online. Students can discover
              services, join queues, and track their
              position while staff can manage service
              queues more efficiently.
            </p>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/10">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-6 py-8 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between">
          <p>
            © {new Date().getFullYear()} QueueX. Smart
            Campus Queues.
          </p>

          <p>
            Built for a smarter campus experience.
          </p>
        </div>
      </footer>
    </main>
  );
}