export interface CampusService {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: string;
  status: "OPEN" | "PAUSED" | "CLOSED";
  averageServiceTime: number;
  createdAt: string;
  updatedAt: string;
}