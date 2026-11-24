// Server-side database client. Holds the service-role key, so it must never
// be imported from a client component (the "server-only" import enforces it
// inside Next; scripts import db-core.ts directly).
import "server-only";
export { db } from "./db-core";
