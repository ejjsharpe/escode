import { createRecoveryCopy, recoverCopy, reconcileRecovery } from "./recovery-copy";
import { inspectRecoveryProvider } from "./recovery-provider";

async function main() {
  const [operation, source, destination, hostId, clientId] = process.argv.slice(2);
  if (operation === "copy" && source && destination && hostId && !clientId) {
    console.log(JSON.stringify(await createRecoveryCopy(source, destination, hostId), null, 2));
  } else if (operation === "recover" && source && destination && hostId && clientId) {
    console.log(JSON.stringify(await recoverCopy(source, destination, { hostId, clientId }), null, 2));
  } else if (operation === "reconcile" && source && destination && hostId && !clientId) {
    const report = await reconcileRecovery(source, { hostId: destination, clientId: hostId }, inspectRecoveryProvider);
    console.log(JSON.stringify(report, null, 2));
    if (!report.ready) process.exitCode = 1;
  } else throw Error("Usage: recovery-admin copy SOURCE COPY SPOOL | recover COPY NEW_SQLITE HOST_ID CLIENT_ID | reconcile NEW_SQLITE HOST_ID CLIENT_ID");
}
void main().catch(error => { console.error(String(error)); process.exitCode = 1; });
