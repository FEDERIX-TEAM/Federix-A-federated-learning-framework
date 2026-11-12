import { startStack, stopStack } from "./stack";

export default async function globalSetup() {
  try {
    await startStack();
  } catch (err) {
    stopStack();
    throw err;
  }
}
