import {
  AppointmentRepository,
  AvailabilityBlockRepository,
  LedgerRepository,
  NotificationRepository,
  PaymentTransactionRepository,
  TimeSlotRepository,
} from './repositories';

export interface TransactionRepositories {
  appointments: AppointmentRepository;
  timeSlots: TimeSlotRepository;
  availabilityBlocks: AvailabilityBlockRepository;
  paymentTransactions: PaymentTransactionRepository;
  ledger: LedgerRepository;
  notifications: NotificationRepository;
}

export interface UnitOfWork {
  withTransaction<T>(fn: (tx: TransactionRepositories) => Promise<T>): Promise<T>;
}