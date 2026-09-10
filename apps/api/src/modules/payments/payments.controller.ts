import { Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { RequirePermissions } from '@/common/decorators';
import { CreatePaymentDto, ListPaymentsQueryDto, VoidPaymentDto } from './dto/payment.dto';
import { PaymentsService } from './payments.service';

@ApiTags('Payments')
@ApiCookieAuth()
@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get()
  @RequirePermissions('payments.view')
  @ApiOperation({
    summary: 'List payments',
    description: 'Voided payments are excluded unless status=VOIDED is requested.',
  })
  @ApiOkResponse({ description: 'Paginated payments with the total for the filter.' })
  list(@Query() query: ListPaymentsQueryDto) {
    return this.payments.list(query);
  }

  @Get(':id')
  @RequirePermissions('payments.view')
  @ApiOperation({ summary: 'One payment with the charge it was applied to' })
  @ApiNotFoundResponse({ description: 'No such payment, or outside your scope.' })
  findOne(@Param('id') id: string) {
    return this.payments.findOne(id);
  }

  @Post()
  @RequirePermissions('payments.create')
  @ApiOperation({
    summary: 'Record a payment and issue a receipt',
    description:
      'One transaction: the charge is locked, the payment written, the balance recomputed and the receipt numbered. Any failure rolls all of it back. Overpayment is refused rather than held as credit.',
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description: 'Send a unique key to make a retried request replay its original response.',
  })
  @ApiCreatedResponse({ description: 'The payment, its receipt and the updated charge.' })
  @ApiConflictResponse({ description: 'That reference has already been recorded.' })
  @ApiUnprocessableEntityResponse({ description: 'More than the amount still owing.' })
  create(
    @Body() dto: CreatePaymentDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.payments.create(dto, idempotencyKey?.slice(0, 200));
  }

  @Post(':id/void')
  @RequirePermissions('payments.void')
  @ApiOperation({
    summary: 'Void a payment and reverse its effect',
    description:
      'Payments are never edited or deleted. The row stays, marked voided, the charge is restored exactly, and the receipt keeps its number so the book has no gaps.',
  })
  @ApiConflictResponse({ description: 'Already voided.' })
  voidPayment(@Param('id') id: string, @Body() dto: VoidPaymentDto) {
    return this.payments.void(id, dto);
  }
}
