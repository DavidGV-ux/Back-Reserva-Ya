import { Db, MongoClient } from 'mongodb';
import { TransactionRepositories, UnitOfWork } from '../../../domain/ports/unit-of-work';
import { createTransactionRepos } from './repositories/repo-factory';

export class MongoUnitOfWork implements UnitOfWork {
  constructor(
    private readonly client: MongoClient,
    private readonly db: Db,
  ) {}

  async withTransaction<T>(fn: (tx: TransactionRepositories) => Promise<T>): Promise<T> {
    const session = this.client.startSession();
    try {
      let result: T | undefined;
      await session.withTransaction(async () => {
        const tx = createTransactionRepos(this.db, session);
        result = await fn(tx);
      });
      if (result === undefined) {
        throw new Error('Transaction callback produced no result');
      }
      return result;
    } finally {
      await session.endSession();
    }
  }
}