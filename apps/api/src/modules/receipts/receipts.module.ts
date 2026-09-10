import { Module } from '@nestjs/common';
import { ReceiptNumberService } from './receipt-number.service';
import { ReceiptsController } from './receipts.controller';
import { ReceiptsService } from './receipts.service';

@Module({
  controllers: [ReceiptsController],
  providers: [ReceiptsService, ReceiptNumberService],
  exports: [ReceiptsService, ReceiptNumberService],
})
export class ReceiptsModule {}
