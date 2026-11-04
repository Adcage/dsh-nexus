import z from "@deepseek-ai/schemastery";
/** Deployment-level configuration accepted by the `dsh-nexus` row. */
interface Config {
  /** Bash executable used when the stored terminal settings name none; Git Bash by default on Windows. */
  bashPath?: string;
  /** PowerShell 7 executable used when the stored terminal settings name none. */
  pwshPath?: string;
}
/** Schemastery schema cordis validates the row's `config` against. */
declare const Config: z<Config>;
export { Config as t };
//# sourceMappingURL=config-C2yeChUF.d.ts.map