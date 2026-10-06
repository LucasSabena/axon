import {test,expect} from 'bun:test';
import {reviewLibraryMove} from './library-transfer-review';
import {includeConfiguredReferences} from './transfer-references';
const library={roots:[],uploadRoot:'',favorites:[],collections:[],shares:[]};
test('registered projects, agent and Drop references require approval without silently changing configuration',()=>{
 const base=reviewLibraryMove(library,'/home/proyecto','/mnt/externo/proyecto',true,[]);
 const result=includeConfiguredReferences(base,'/home/proyecto','/mnt/externo/proyecto',[
  {title:'Proyecto',path:'/home/proyecto',detail:'Revisá la configuración'},
  {title:'Agente',path:'/home/proyecto/.agent',detail:'Revisá la configuración'},
  {title:'Drop',path:'/home/proyecto/documento.pdf',detail:'Volvé a compartir'},
  {title:'Proyecto vecino',path:'/home/proyecto2',detail:'No afectado'}
 ]);
 expect(result.needsConfirmation).toBe(true);expect(result.impacts).toHaveLength(3);expect(result.addRoots).toEqual([]);
 expect(result.impacts.every(i=>i.kind==='configuration')).toBe(true);expect(result.revision).not.toBe(base.revision);
});
test('moving content out of a backup source warns while changes within its tree do not',()=>{
 const refs=[{title:'Respaldo',path:'/datos',tree:true,detail:'Puede dejar de incluir estos archivos'}];
 const review=(to:string)=>includeConfiguredReferences(reviewLibraryMove(library,'/datos/fotos',to,true,[]),'/datos/fotos',to,refs);
 expect(review('/mnt/externo/fotos').needsConfirmation).toBe(true);expect(review('/datos/otras-fotos').needsConfirmation).toBe(false);
});
test('mount aliases are included and changing an affected registered path invalidates approval',()=>{
 const base=reviewLibraryMove(library,'/mnt/externo/fotos','/media/nuevo',true,[],['/mnt/externo/fotos','/alias/fotos']);
 const refs=[{title:'Drop',path:'/alias/fotos/a.jpg',detail:'Revisá el link'}];
 const initial=includeConfiguredReferences(base,'/mnt/externo/fotos','/media/nuevo',refs);
 expect(initial.impacts[0].paths[0].to).toBe('/media/nuevo/a.jpg');refs[0].path='/alias/fotos/b.jpg';
 expect(includeConfiguredReferences(base,'/mnt/externo/fotos','/media/nuevo',refs).revision).not.toBe(initial.revision);
});
