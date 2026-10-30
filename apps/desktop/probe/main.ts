import { runProbe } from "./probe";
runProbe(process.argv.includes("--live")).then(
  (result) => console.log(JSON.stringify(result)),
  (error) => { console.error(error); process.exitCode = 1; },
);
