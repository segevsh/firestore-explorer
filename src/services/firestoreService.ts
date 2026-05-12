import type { Firestore, DocumentSnapshot } from "firebase-admin/firestore";
import type { FirestoreDoc, QueryDef, SortSpec } from "../types";

export interface FetchResult {
  documents: FirestoreDoc[];
  hasMore: boolean;
}

export class FirestoreService {
  constructor(private db: Firestore) {}

  async listCollections(): Promise<string[]> {
    const collections = await this.db.listCollections();
    return collections.map((c) => c.id);
  }

  async getDocuments(
    collectionPath: string,
    limit: number,
    afterDocId?: string,
    orderBy?: SortSpec
  ): Promise<FetchResult> {
    let query: FirebaseFirestore.Query = this.db.collection(collectionPath);

    if (orderBy && orderBy.field) {
      query = query.orderBy(orderBy.field, orderBy.direction);
    }

    query = query.limit(limit);

    if (afterDocId) {
      const afterDoc = await this.db
        .collection(collectionPath)
        .doc(afterDocId)
        .get();
      if (afterDoc.exists) {
        query = query.startAfter(afterDoc);
      }
    }

    const snapshot = await query.get();
    const documents = snapshot.docs.map((doc) => this.docToFirestoreDoc(doc));
    return { documents, hasMore: snapshot.docs.length === limit };
  }

  async getDocument(docPath: string): Promise<FirestoreDoc> {
    const parts = docPath.split("/");
    const collectionPath = parts.slice(0, -1).join("/");
    const docId = parts[parts.length - 1];

    const doc = await this.db.collection(collectionPath).doc(docId).get();
    if (!doc.exists) {
      throw new Error(`Document not found: ${docPath}`);
    }
    return this.docToFirestoreDoc(doc);
  }

  async saveDocument(
    docPath: string,
    data: Record<string, unknown>
  ): Promise<void> {
    const parts = docPath.split("/");
    const collectionPath = parts.slice(0, -1).join("/");
    const docId = parts[parts.length - 1];

    await this.db.collection(collectionPath).doc(docId).set(data, { merge: false });
  }

  async listSubCollections(docPath: string): Promise<string[]> {
    const parts = docPath.split("/");
    const collectionPath = parts.slice(0, -1).join("/");
    const docId = parts[parts.length - 1];

    const collections = await this.db
      .collection(collectionPath)
      .doc(docId)
      .listCollections();
    return collections.map((c) => c.id);
  }

  async executeQuery(queryDef: QueryDef): Promise<FetchResult> {
    let query: FirebaseFirestore.Query = this.db.collection(queryDef.collection);

    for (const group of queryDef.groups) {
      for (const clause of group.clauses) {
        query = query.where(clause.field, clause.operator, clause.value);
      }
    }

    if (queryDef.orderBy) {
      for (const order of queryDef.orderBy) {
        query = query.orderBy(order.field, order.direction);
      }
    }

    const limit = queryDef.limit ?? 500;
    query = query.limit(limit);

    const snapshot = await query.get();
    const documents = snapshot.docs.map((doc) => this.docToFirestoreDoc(doc));
    return { documents, hasMore: snapshot.docs.length === limit };
  }

  private docToFirestoreDoc(doc: DocumentSnapshot): FirestoreDoc {
    return {
      id: doc.id,
      path: doc.ref.path,
      data: (doc.data() as Record<string, unknown>) ?? {},
      createTime: doc.createTime?.toDate().toISOString(),
      updateTime: doc.updateTime?.toDate().toISOString(),
    };
  }
}
