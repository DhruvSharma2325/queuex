export type QueueStatus = "OPEN" | "PAUSED" | "CLOSED";

export type TokenStatus =
  | "WAITING"
  | "CALLED"
  | "SERVING"
  | "SERVED"
  | "CANCELLED"
  | "NO_SHOW";

export interface QueueService {
  id: string;
  name: string;
  description: string;
  icon: string;
  status: QueueStatus;
  averageServiceTime: number;
  currentTokenNumber: number;
  totalWaiting: number;
  createdAt: string;
}

export interface QueueToken {
  id: string;
  serviceId: string;
  userId: string;
  tokenNumber: number;
  status: TokenStatus;
  joinedAt: string;
  calledAt?: string;
  servedAt?: string;
  cancelledAt?: string;
}