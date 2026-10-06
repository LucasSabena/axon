import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdirSync, lstatSync, fstatSync, fsyncSync, linkSync, unlinkSync, openSync, closeSync, writeSync, readFileSync, constants } from 'node:fs';
import path from 'node:path';

/** The key travels with AXON data/backup, separately from encrypted database records. */
export class CloudVault {
  private key: Buffer;
  constructor(dir: string) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const s = lstatSync(dir);
    if (s.isSymbolicLink() || (s.mode & 0o077)) throw new Error('Las conexiones cloud necesitan un directorio privado');
    const file = path.join(dir, 'vault.key');
    const temporary=path.join(dir,'key-'+randomBytes(16).toString('hex'));
    try {
      const fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try { writeSync(fd, randomBytes(32)); fsyncSync(fd); } finally { closeSync(fd); }
      try{linkSync(temporary,file);}catch(e:any){if(e.code!=='EEXIST')throw e;}
    } finally {try{unlinkSync(temporary);}catch{}}
    const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    try { this.key = readFileSync(fd);if (!fstatSync(fd).isFile() || (fstatSync(fd).mode & 0o077))throw new Error('Clave cloud accesible por otros usuarios'); } finally { closeSync(fd); }
    if (this.key.length !== 32) throw new Error('Clave cloud inválida');
  }
  seal(value: unknown, context: string): string {
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(context));
    return Buffer.concat([iv, cipher.update(JSON.stringify(value)), cipher.final(), cipher.getAuthTag()]).toString('base64');
  }
  open<T>(value: string, context: string): T {
    const bytes = Buffer.from(value, 'base64'), decipher = createDecipheriv('aes-256-gcm', this.key, bytes.subarray(0, 12));
    decipher.setAAD(Buffer.from(context)); decipher.setAuthTag(bytes.subarray(-16));
    return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(12, -16)), decipher.final()]).toString());
  }
}
