import { Controller, Get } from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";
import { AppService } from "./app.service";

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  @SkipThrottle()
  getRoot() {
    return this.appService.getRoot();
  }

  @Get("health")
  @SkipThrottle()
  getHealth() {
    return this.appService.getHealth();
  }
}
