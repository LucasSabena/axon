export type DecimalBytes = string;
export type OperationState = 'planned' | 'running' | 'verified' | 'skipped' | 'failed' | 'interrupted' | 'cancel-requested' | 'restored';
export interface Identity {
  canonicalPath: string; device: string; inode: string; mountId: string; size: DecimalBytes;
  mtimeNs: string; ownerUid: number; kind: 'file' | 'directory' | 'symlink';
}
export interface Candidate {
  id: string; adapterId: string; adapterVersion: number; category: string; title: string; reason: string;
  identity: Identity; allocatedBytes: DecimalBytes | null; logicalBytes: DecimalBytes | null;
  reclaimableBytes: DecimalBytes | null; estimateConfidence: 'exact' | 'upper-bound' | 'unknown';
  risk: 'rebuildable' | 'review' | 'sensitive'; recovery: 'none' | 'restore-from-trash' | 'reinstall' | 'regenerate';
  references: { source: string; resourceId: string }[]; blockers: string[]; requiredCapabilities: string[];
  complete: boolean; entries: number; originalPath?: string; deletedAt?: string;
}
export interface ScanRoot { id: string; path: string; title: string; adapterId: string; depth?: number; trashTop?:string }
export interface Mount { id: string; path: string; device: string; type: string; medium: 'disk' | 'ram' | 'excluded'; freeBytes?: string; totalBytes?: string }
export interface ScanResult {
  candidates: Candidate[]; mounts: Mount[]; complete: boolean; errors: string[];
  metrics: { elapsedMs: number; cpuMs: number; peakRssBytes: number; readBytes: string; entries: number };
}
export interface Scan { id: string; at: string; state: OperationState; policyRevision: string; rootId: string; result?: ScanResult; error?: string }
export interface Step { id: string; adapterId: string; actionId: 'fixture-unlink' | 'review-only'|'host-clean'; candidate: Candidate; locks: string[]; interruptions: string[]; expectedRecovery: Candidate['recovery'];taskId?:string }
export interface CleanupPlan {
  id: string; actorId: string; sessionId: string; createdAt: string; expiresAt: string; inventoryRevision: string;
  policyRevision: string; digest: string; selectedCandidateIds: string[]; steps: Step[]; state: OperationState;
}
export interface Receipt { stepId: string; state: OperationState; message: string; retiredBytes?: string; freeBytesBefore?: string; freeBytesAfter?: string }
export interface Actor { actorId: string; sessionId: string }
export class MaintenanceError extends Error {
  constructor(message: string, public status = 409) { super(message); }
  getResponse(): Response { return Response.json({ok:false,error:this.message},{status:this.status,headers:{'Cache-Control':'private, no-store'}}); }
}
export interface PendingOperation {
  id:string;kind:'transfer'|'file-operation'|'plan'|'scan';state:string;action?:string;
  from?:string;to?:string;message?:string;logicalBytes?:string;copiedBytes?:string;
}
export class PendingOperationError extends MaintenanceError {
  constructor(readonly pending?:PendingOperation){
    const action=pending?.action==='move'?'movimiento':pending?.action==='copy'?'copia':pending?.action==='purge'?'borrado definitivo':pending?.kind==='scan'?'análisis':'trabajo';
    const name=pending?.from?.split('/').pop();
    super(pending?`Hay un ${action} ${pending.state==='running'?'en curso':'pendiente de comprobar'}${name?`: ${name}`:''}. Comprobá su resultado antes de volver a intentar esta acción.`:'El recurso está ocupado por otro trabajo. Comprobá las operaciones pendientes antes de volver a intentarlo.');
  }
  override getResponse(){return Response.json({ok:false,error:this.message,code:'operation-pending',...(this.pending?{pending:this.pending}:{})},{status:this.status,headers:{'Cache-Control':'private, no-store'}});}
}
