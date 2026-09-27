export type UserRole = "STUDENT" | "STAFF" | "ADMIN";

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  registrationNumber?: string;
  phone?: string;
  createdAt: string;
}