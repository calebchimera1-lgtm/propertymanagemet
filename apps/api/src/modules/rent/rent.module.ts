import { Global, Module } from '@nestjs/common';
import { FinanceCalculationService } from './finance-calculation.service';
import { RentController } from './rent.controller';
import { RentGenerationService } from './rent-generation.service';
import { RentService } from './rent.service';

/**
 * Global because FinanceCalculationService is the single home of every money
 * formula: payments, expenses and (from Phase 6) reports all call into it, and
 * a second instance would be a second definition of "net income".
 */
@Global()
@Module({
  controllers: [RentController],
  providers: [RentService, RentGenerationService, FinanceCalculationService],
  exports: [RentService, RentGenerationService, FinanceCalculationService],
})
export class RentModule {}
