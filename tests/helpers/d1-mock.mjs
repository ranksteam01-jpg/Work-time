import { DatabaseSync } from 'node:sqlite';

export class D1Mock {
  constructor(filename = ':memory:') {
    this.db = new DatabaseSync(filename);
  }

  exec(sql) {
    this.db.exec(sql);
  }

  prepare(sql) {
    const db = this.db;
    let params = [];
    return {
      bind(...values) {
        params = values;
        return this;
      },
      async first(columnName) {
        const stmt = db.prepare(sql);
        const row = stmt.get(...params);
        if (row == null) return null;
        return columnName ? row[columnName] ?? null : row;
      },
      async all() {
        const stmt = db.prepare(sql);
        return { success: true, results: stmt.all(...params), meta: {} };
      },
      async run() {
        const stmt = db.prepare(sql);
        const result = stmt.run(...params);
        return { success: true, results: [], meta: { changes: Number(result.changes) } };
      },
    };
  }

  close() {
    this.db.close();
  }
}
