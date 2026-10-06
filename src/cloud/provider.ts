import type { Actor } from '../storage/types';
import type { CloudEntry } from './dropbox';

/** Host paths never enter provider APIs. Each adapter owns its remote identifiers. */
export interface CloudProvider {
  status(owner:string): {configured:boolean;serverConfigured:boolean;connected:boolean;account:{name:string;email:string}|null;sources:{id:string;name:string;type:string}[];clientId?:string;uploadSupported?:boolean;uploadGranted?:boolean};
  connectionIdentity?(owner:string):string;
  validateRemotePath?(owner:string,source:string,path:string):Promise<void>|void;
  authorize(by:Actor,origin:string,upload?:boolean):string;
  callback(by:Actor,state:unknown,code:unknown,denied?:boolean):Promise<void>;
  disconnect(owner:string):Promise<void>;
  source(owner:string,id:string):unknown;
  list(owner:string,id:string,p:string,cursor?:string):Promise<{entries:CloudEntry[];cursor:string|null;breadcrumbs?:{name:string;path:string}[]}>;
  metadata(owner:string,id:string,p:string):Promise<CloudEntry>;
  content(owner:string,id:string,p:string,revision?:string,range?:string,signal?:AbortSignal):Promise<Response>;
}

export interface CloudUploadProvider extends CloudProvider {
  beginUpload(owner:string):Promise<string>;
  appendUpload(owner:string,session:string,offset:number,data:Uint8Array,signal?:AbortSignal):Promise<number>;
  finishUpload(owner:string,session:string,offset:number,path:string,signal?:AbortSignal):Promise<CloudEntry>;
}
