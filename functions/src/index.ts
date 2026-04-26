import { onDocumentCreated } from "firebase-functions/v2/firestore";

// TODO: implement generation request trigger
export const onGenerationRequestCreated = onDocumentCreated(
  "generation_requests/{docId}",
  async (event) => {}
);