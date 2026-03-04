import { Injectable } from "@nestjs/common";

@Injectable()
export class AppService {
  getRoot() {
    return {
      service: "api",
      name: "Marinantex Legal Editor API",
      status: "running",
    };
  }

  getHealth() {
    return {
      service: "api",
      status: "ok",
      timestamp: new Date().toISOString(),
    };
  }
}
