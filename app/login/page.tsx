"use client";

import { FormEvent, useState } from "react";
import {
  GoogleAuthProvider,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
} from "firebase/auth";
import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";

import { auth } from "@/lib/firebase/auth";
import { db } from "@/lib/firebase/firestore";

type UserProfile = {
  name?: string;
  email?: string | null;
  role?: "student" | "staff";
  serviceId?: string;
};

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [loading, setLoading] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);

  /*
   * ---------------------------------------------------------
   * COMPLETE LOGIN PROFILE HANDLING
   * ---------------------------------------------------------
   *
   * Important:
   * We NEVER overwrite an existing user's role.
   *
   * Existing staff:
   *   role = staff
   *   serviceId = certificate-office
   *
   * Existing student:
   *   role = student
   *
   * New account:
   *   role = student
   */

  const handleUserProfile = async (
    uid: string,
    displayName: string | null,
    userEmail: string | null
  ): Promise<"student" | "staff"> => {
    const userRef = doc(db, "users", uid);

    const userSnapshot = await getDoc(userRef);

    /*
     * EXISTING USER
     *
     * Only update lastLoginAt.
     *
     * We deliberately do NOT write:
     * - role
     * - serviceId
     *
     * This protects the staff account.
     */

    if (userSnapshot.exists()) {
      const existingProfile =
        userSnapshot.data() as UserProfile;

      await updateDoc(userRef, {
        lastLoginAt: serverTimestamp(),
      });

      if (existingProfile.role === "staff") {
        return "staff";
      }

      return "student";
    }

    /*
     * NEW USER
     *
     * New accounts are students by default.
     */

    await setDoc(userRef, {
      name:
        displayName ||
        userEmail?.split("@")[0] ||
        "QueueX Student",
      email: userEmail,
      role: "student",
      lastLoginAt: serverTimestamp(),
    });

    return "student";
  };

  /*
   * ---------------------------------------------------------
   * EMAIL / PASSWORD LOGIN
   * ---------------------------------------------------------
   */

  const handleLogin = async (
    event: FormEvent<HTMLFormElement>
  ) => {
    event.preventDefault();

    setError("");
    setSuccess("");

    if (!email.trim()) {
      setError("Please enter your email.");
      return;
    }

    if (!password) {
      setError("Please enter your password.");
      return;
    }

    try {
      setLoading(true);

      const userCredential =
        await signInWithEmailAndPassword(
          auth,
          email.trim(),
          password
        );

      const user = userCredential.user;

      const role = await handleUserProfile(
        user.uid,
        user.displayName,
        user.email
      );

      /*
       * Redirect based on the protected Firestore role.
       */

      if (role === "staff") {
        window.location.href = "/staff";
      } else {
        window.location.href = "/dashboard";
      }
    } catch (error: unknown) {
      console.error("Login failed:", error);

      if (error instanceof Error) {
        setError(
          getFirebaseErrorMessage(error.message)
        );
      } else {
        setError("Unable to log in.");
      }
    } finally {
      setLoading(false);
    }
  };

  /*
   * ---------------------------------------------------------
   * FORGOT PASSWORD
   * ---------------------------------------------------------
   *
   * Firebase sends a secure password-reset email to the
   * address entered in the email field.
   */

  const handleForgotPassword = async () => {
    setError("");
    setSuccess("");

    if (!email.trim()) {
      setError(
        "Enter your email address first, then click Forgot password."
      );
      return;
    }

    try {
      setResetLoading(true);

      await sendPasswordResetEmail(
        auth,
        email.trim()
      );

      setSuccess(
        "Password reset email sent. Check your inbox and spam folder."
      );
    } catch (error: unknown) {
      console.error(
        "Password reset failed:",
        error
      );

      if (error instanceof Error) {
        setError(
          getPasswordResetErrorMessage(
            error.message
          )
        );
      } else {
        setError(
          "Unable to send the password reset email."
        );
      }
    } finally {
      setResetLoading(false);
    }
  };

  /*
   * ---------------------------------------------------------
   * GOOGLE LOGIN
   * ---------------------------------------------------------
   */

  const handleGoogleLogin = async () => {
    setError("");
    setSuccess("");

    try {
      setLoading(true);

      const provider = new GoogleAuthProvider();

      const result = await signInWithPopup(
        auth,
        provider
      );

      const role = await handleUserProfile(
        result.user.uid,
        result.user.displayName,
        result.user.email
      );

      /*
       * Existing staff accounts remain staff.
       * New Google accounts become students.
       */

      if (role === "staff") {
        window.location.href = "/staff";
      } else {
        window.location.href = "/dashboard";
      }
    } catch (error: unknown) {
      console.error(
        "Google login failed:",
        error
      );

      if (error instanceof Error) {
        setError(
          getFirebaseErrorMessage(error.message)
        );
      } else {
        setError(
          "Unable to continue with Google."
        );
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#07111f] text-white flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <a
            href="/"
            className="text-3xl font-bold tracking-tight text-cyan-400"
          >
            QueueX
          </a>

          <h1 className="mt-6 text-3xl font-bold">
            Welcome back
          </h1>

          <p className="mt-2 text-sm text-slate-400">
            Log in to manage your campus queues.
          </p>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-[#0b1728] p-6 shadow-2xl">
          {error && (
            <div className="mb-5 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
              {error}
            </div>
          )}

          {success && (
            <div className="mb-5 rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-300">
              {success}
            </div>
          )}

          <form
            onSubmit={handleLogin}
            className="space-y-4"
          >
            <div>
              <label
                htmlFor="email"
                className="mb-2 block text-sm font-medium text-slate-300"
              >
                Email
              </label>

              <input
                id="email"
                type="email"
                value={email}
                onChange={(event) =>
                  setEmail(event.target.value)
                }
                placeholder="you@example.com"
                autoComplete="email"
                required
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-4 py-3 text-white outline-none transition focus:border-cyan-400"
              />
            </div>

            <div>
              <label
                htmlFor="password"
                className="mb-2 block text-sm font-medium text-slate-300"
              >
                Password
              </label>

              <input
                id="password"
                type="password"
                value={password}
                onChange={(event) =>
                  setPassword(event.target.value)
                }
                placeholder="Enter your password"
                autoComplete="current-password"
                required
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-4 py-3 text-white outline-none transition focus:border-cyan-400"
              />
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                className="text-sm font-medium text-cyan-400 hover:text-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"
                onClick={handleForgotPassword}
                disabled={
                  loading || resetLoading
                }
              >
                {resetLoading
                  ? "Sending reset email..."
                  : "Forgot password?"}
              </button>
            </div>

            <button
              type="submit"
              disabled={
                loading || resetLoading
              }
              className="w-full rounded-lg bg-cyan-400 px-4 py-3 font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading
                ? "Logging in..."
                : "Log In"}
            </button>
          </form>

          <div className="my-6 flex items-center gap-3">
            <div className="h-px flex-1 bg-slate-800" />

            <span className="text-xs text-slate-500">
              OR
            </span>

            <div className="h-px flex-1 bg-slate-800" />
          </div>

          <button
            type="button"
            onClick={handleGoogleLogin}
            disabled={
              loading || resetLoading
            }
            className="w-full rounded-lg border border-slate-700 bg-slate-900 px-4 py-3 font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Continue with Google
          </button>

          <p className="mt-6 text-center text-sm text-slate-400">
            Don't have an account?{" "}
            <a
              href="/register"
              className="font-medium text-cyan-400 hover:text-cyan-300"
            >
              Create one
            </a>
          </p>
        </div>
      </div>
    </main>
  );
}

/*
 * ---------------------------------------------------------
 * FIREBASE ERROR MESSAGES
 * ---------------------------------------------------------
 */

function getFirebaseErrorMessage(
  message: string
) {
  if (
    message.includes(
      "auth/invalid-credential"
    ) ||
    message.includes(
      "auth/invalid-login-credentials"
    )
  ) {
    return "Incorrect email or password.";
  }

  if (
    message.includes(
      "auth/user-not-found"
    )
  ) {
    return "No QueueX account was found with this email.";
  }

  if (
    message.includes(
      "auth/wrong-password"
    )
  ) {
    return "Incorrect password.";
  }

  if (
    message.includes(
      "auth/invalid-email"
    )
  ) {
    return "Please enter a valid email address.";
  }

  if (
    message.includes(
      "auth/too-many-requests"
    )
  ) {
    return "Too many login attempts. Please try again later.";
  }

  if (
    message.includes(
      "auth/popup-closed-by-user"
    )
  ) {
    return "Google sign-in was cancelled.";
  }

  return message;
}

/*
 * ---------------------------------------------------------
 * PASSWORD RESET ERROR MESSAGES
 * ---------------------------------------------------------
 */

function getPasswordResetErrorMessage(
  message: string
) {
  if (
    message.includes(
      "auth/invalid-email"
    )
  ) {
    return "Please enter a valid email address.";
  }

  if (
    message.includes(
      "auth/user-not-found"
    )
  ) {
    return "No QueueX account was found with this email.";
  }

  if (
    message.includes(
      "auth/too-many-requests"
    )
  ) {
    return "Too many requests. Please wait a little and try again.";
  }

  return "Unable to send the password reset email. Please try again.";
}