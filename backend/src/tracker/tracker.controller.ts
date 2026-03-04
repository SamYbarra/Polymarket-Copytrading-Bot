import { Controller, Get, Query, Sse } from '@nestjs/common';
import { TrackerService } from './tracker.service';
import { Observable, timer, from } from 'rxjs';
import { switchMap, map } from 'rxjs/operators';

@Controller('api')
export class TrackerController {
  constructor(private readonly tracker: TrackerService) {}

  @Sse('dashboard-stream')
  dashboardStream(): Observable<{ data: unknown }> {
    return timer(0, 2000).pipe(
      switchMap(() => from(this.tracker.getDashboardStreamPayload())),
      map((payload) => ({ data: payload })),
    );
  }

  @Get('current-market-state')
  currentMarketState() {
    return this.tracker.getCurrentMarketState();
  }

  @Get('current-market')
  currentMarket() {
    return this.tracker.getCurrentMarket();
  }

  @Get('status')
  status() {
    return this.tracker.getStatus();
  }

  @Get('ml/current')
  mlCurrent() {
    return this.tracker.getMlCurrent();
  }

  @Get('wallet-stats')
  walletStats() {
    return this.tracker.getWalletStats();
  }

  @Get('predictions')
  predictions(
    @Query('includeResolved') includeResolved?: string,
    @Query('limit') limit?: string,
  ) {
    const limitNum = Math.min(
      Math.max(1, parseInt(limit || '50', 10) || 50),
      500,
    );
    // Default includeResolved=true so all predictions are returned; pass includeResolved=false for unresolved only
    const includeResolvedBool = includeResolved !== 'false';
    return this.tracker.getPredictions(includeResolvedBool, limitNum);
  }

  @Get('prediction-accuracy')
  predictionAccuracy() {
    return this.tracker.getPredictionAccuracy();
  }

  @Get('results')
  results(
    @Query('eventSlug') eventSlug?: string,
    @Query('conditionId') conditionId?: string,
  ) {
    return this.tracker.getMarketResults(
      eventSlug || conditionId ? { eventSlug, conditionId } : undefined,
    );
  }

  @Get('redis-state')
  redisState() {
    return this.tracker.getRedisState();
  }

  @Get('wallet-balance')
  walletBalance() {
    return this.tracker.getWalletBalance();
  }

  @Get('my-orders')
  myOrders(@Query('market') market?: string) {
    return this.tracker.getMyOrders(market ?? '');
  }
}
