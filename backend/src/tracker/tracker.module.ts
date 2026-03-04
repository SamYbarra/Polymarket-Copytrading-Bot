import { Module } from '@nestjs/common';
import { TrackerController } from './tracker.controller';
import { TrackerService } from './tracker.service';
import { MongoService } from '../services/mongo.service';
import { RedisService } from '../services/redis.service';
import { BtcPriceService } from '../services/btc-price.service';
import { GammaService } from '../services/gamma.service';
import { ClobService } from '../services/clob.service';

@Module({
  controllers: [TrackerController],
  providers: [TrackerService, MongoService, RedisService, BtcPriceService, GammaService, ClobService],
})
export class TrackerModule {}
