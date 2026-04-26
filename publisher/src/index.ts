import { initializeApp } from "firebase/app";
import { getAuth, signInAnonymously, connectAuthEmulator } from "firebase/auth";
import {
  getFirestore,
  connectFirestoreEmulator,
  collection,
  addDoc,
} from "firebase/firestore";

const FIREBASE_PROJECT_ID = process.env["FIREBASE_PROJECT_ID"] ?? "demo-local";
const AUTH_EMULATOR_HOST = process.env["AUTH_EMULATOR_HOST"] ?? "127.0.0.1:9099";
const FIRESTORE_EMULATOR = process.env["FIRESTORE_EMULATOR_HOST"] ?? "127.0.0.1:8080";
const [FIRESTORE_EMULATOR_HOST, FIRESTORE_EMULATOR_PORT_STR] = FIRESTORE_EMULATOR.split(":");
const FIRESTORE_EMULATOR_PORT = parseInt(FIRESTORE_EMULATOR_PORT_STR ?? "8080");

const PROMPTS = [
  "a forest cabin in winter, oil painting style",
  "a samurai standing in cherry blossom rain, anime style",
  "a futuristic city at night, photorealistic",
];

async function main() {
  const app = initializeApp({
    projectId: FIREBASE_PROJECT_ID,
    apiKey: "demo-api-key",          // required by SDK, value doesn't matter for emulators
    authDomain: "demo-local.firebaseapp.com",
  });

  const auth = getAuth(app);
  connectAuthEmulator(auth, `http://${AUTH_EMULATOR_HOST}`, {
    disableWarnings: true,
  });

  const db = getFirestore(app);
  connectFirestoreEmulator(db, FIRESTORE_EMULATOR_HOST, FIRESTORE_EMULATOR_PORT);

  const credential = await signInAnonymously(auth);
  const uid = credential.user.uid;
  console.log(`Signed in anonymously as: ${uid}`);

  for (const prompt of PROMPTS) {
    const docRef = await addDoc(collection(db, "generation_requests"), {
      user_id: uid,
      prompt,
      status: "CREATED",
    });
    console.log(`Created document: ${docRef.id} — "${prompt}"`);
  }

  console.log("Done. Exiting.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Publisher failed:", err);
  process.exit(1);
});