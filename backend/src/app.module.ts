import { Module } from '@nestjs/common';
import { TrackerModule } from './tracker/tracker.module';

@Module({
  imports: [TrackerModule],
})
export class AppModule {}
