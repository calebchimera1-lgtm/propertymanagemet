import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { RequirePermissions } from '@/common/decorators';
import {
  CreateExpenseDto,
  ExpenseSummaryQueryDto,
  ListExpensesQueryDto,
  UpdateExpenseDto,
} from './dto/expense.dto';
import { ExpensesService } from './expenses.service';

@ApiTags('Expenses')
@ApiCookieAuth()
@Controller('expenses')
export class ExpensesController {
  constructor(private readonly expenses: ExpensesService) {}

  @Get()
  @RequirePermissions('expenses.view')
  @ApiOperation({
    summary: 'List expenses',
    description: 'Returns the total for the current filter, not just the visible page.',
  })
  @ApiOkResponse({ description: 'Paginated expenses with a filter total.' })
  list(@Query() query: ListExpensesQueryDto) {
    return this.expenses.list(query);
  }

  @Get('summary')
  @RequirePermissions('expenses.view')
  @ApiOperation({ summary: 'Expense totals by category' })
  summary(@Query() query: ExpenseSummaryQueryDto) {
    return this.expenses.summary(query);
  }

  @Get(':id')
  @RequirePermissions('expenses.view')
  @ApiOperation({ summary: 'One expense' })
  @ApiNotFoundResponse({ description: 'No such expense, or outside your scope.' })
  findOne(@Param('id') id: string) {
    return this.expenses.findOne(id);
  }

  @Post()
  @RequirePermissions('expenses.create')
  @ApiOperation({ summary: 'Record an expense against a property' })
  @ApiCreatedResponse({ description: 'The created expense.' })
  create(@Body() dto: CreateExpenseDto) {
    return this.expenses.create(dto);
  }

  @Patch(':id')
  @RequirePermissions('expenses.update')
  @ApiOperation({
    summary: 'Update an expense',
    description: 'The property is fixed: moving it would rewrite two properties’ figures at once.',
  })
  update(@Param('id') id: string, @Body() dto: UpdateExpenseDto) {
    return this.expenses.update(id, dto);
  }

  @Delete(':id')
  @RequirePermissions('expenses.delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete an expense',
    description:
      'Unlike a payment, an expense is the organization’s own statement of spending, so a mistake is corrected rather than reversed. The deletion is audited with its amount.',
  })
  @ApiNoContentResponse({ description: 'Deleted.' })
  remove(@Param('id') id: string): Promise<void> {
    return this.expenses.remove(id);
  }
}
