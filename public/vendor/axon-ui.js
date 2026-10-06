/*! Copyright 2026 Fonticons, Inc. - https://webawesome.com/license */var yo=()=>({checkValidity(t){let e=t.input,o={message:"",isValid:!0,invalidKeys:[]};if(!e)return o;let i=!0;if("checkValidity"in e)i=e.checkValidity();if(i)return o;if(o.isValid=!1,"validationMessage"in e)o.message=e.validationMessage;if(!("validity"in e))return o.invalidKeys.push("customError"),o;for(let n in e.validity){if(n==="valid")continue;let r=n;if(e.validity[r])o.invalidKeys.push(r)}return o}});/*! Copyright 2026 Fonticons, Inc. - https://webawesome.com/license */var se=class extends Event{constructor(){super("wa-invalid",{bubbles:!0,cancelable:!1,composed:!0})}};/*! Copyright 2026 Fonticons, Inc. - https://webawesome.com/license */var{defineProperty:cn,getOwnPropertyDescriptor:dn}=Object,Co=(t)=>{throw TypeError(t)},l=(t,e,o,i)=>{var n=i>1?void 0:i?dn(e,o):e;for(var r=t.length-1,a;r>=0;r--)if(a=t[r])n=(i?a(e,o,n):a(n))||n;if(i&&n)cn(e,o,n);return n},xo=(t,e,o)=>e.has(t)||Co("Cannot "+o),Lo=(t,e,o)=>(xo(t,e,"read from private field"),o?o.call(t):e.get(t)),So=(t,e,o)=>e.has(t)?Co("Cannot add the same private member more than once"):e instanceof WeakSet?e.add(t):e.set(t,o),Ao=(t,e,o,i)=>(xo(t,e,"write to private field"),i?i.call(t,o):e.set(t,o),o);var le=globalThis,ce=le.ShadowRoot&&(le.ShadyCSS===void 0||le.ShadyCSS.nativeShadow)&&"adoptedStyleSheets"in Document.prototype&&"replace"in CSSStyleSheet.prototype,De=Symbol(),Eo=new WeakMap;class de{constructor(t,e,o){if(this._$cssResult$=!0,o!==De)throw Error("CSSResult is not constructable. Use `unsafeCSS` or `css` instead.");this.cssText=t,this.t=e}get styleSheet(){let t=this.o,e=this.t;if(ce&&t===void 0){let o=e!==void 0&&e.length===1;o&&(t=Eo.get(e)),t===void 0&&((this.o=t=new CSSStyleSheet).replaceSync(this.cssText),o&&Eo.set(e,t))}return t}toString(){return this.cssText}}var $o=(t)=>new de(typeof t=="string"?t:t+"",void 0,De),S=(t,...e)=>{let o=t.length===1?t[0]:e.reduce((i,n,r)=>i+((a)=>{if(a._$cssResult$===!0)return a.cssText;if(typeof a=="number")return a;throw Error("Value passed to 'css' function must be a 'css' function result: "+a+". Use 'unsafeCSS' to pass non-literal values, but take care to ensure page security.")})(n)+t[r+1],t[0]);return new de(o,t,De)},zo=(t,e)=>{if(ce)t.adoptedStyleSheets=e.map((o)=>o instanceof CSSStyleSheet?o:o.styleSheet);else for(let o of e){let i=document.createElement("style"),n=le.litNonce;n!==void 0&&i.setAttribute("nonce",n),i.textContent=o.cssText,t.appendChild(i)}},Be=ce?(t)=>t:(t)=>t instanceof CSSStyleSheet?((e)=>{let o="";for(let i of e.cssRules)o+=i.cssText;return $o(o)})(t):t;var{is:un,defineProperty:mn,getOwnPropertyDescriptor:hn,getOwnPropertyNames:pn,getOwnPropertySymbols:fn,getPrototypeOf:gn}=Object,ue=globalThis,ko=ue.trustedTypes,vn=ko?ko.emptyScript:"",wn=ue.reactiveElementPolyfillSupport,Wt=(t,e)=>t,jt={toAttribute(t,e){switch(e){case Boolean:t=t?vn:null;break;case Object:case Array:t=t==null?t:JSON.stringify(t)}return t},fromAttribute(t,e){let o=t;switch(e){case Boolean:o=t!==null;break;case Number:o=t===null?null:Number(t);break;case Object:case Array:try{o=JSON.parse(t)}catch(i){o=null}}return o}},me=(t,e)=>!un(t,e),_o={attribute:!0,type:String,converter:jt,reflect:!1,useDefault:!1,hasChanged:me};Symbol.metadata??=Symbol("metadata"),ue.litPropertyMetadata??=new WeakMap;class mt extends HTMLElement{static addInitializer(t){this._$Ei(),(this.l??=[]).push(t)}static get observedAttributes(){return this.finalize(),this._$Eh&&[...this._$Eh.keys()]}static createProperty(t,e=_o){if(e.state&&(e.attribute=!1),this._$Ei(),this.prototype.hasOwnProperty(t)&&((e=Object.create(e)).wrapped=!0),this.elementProperties.set(t,e),!e.noAccessor){let o=Symbol(),i=this.getPropertyDescriptor(t,o,e);i!==void 0&&mn(this.prototype,t,i)}}static getPropertyDescriptor(t,e,o){let{get:i,set:n}=hn(this.prototype,t)??{get(){return this[e]},set(r){this[e]=r}};return{get:i,set(r){let a=i?.call(this);n?.call(this,r),this.requestUpdate(t,a,o)},configurable:!0,enumerable:!0}}static getPropertyOptions(t){return this.elementProperties.get(t)??_o}static _$Ei(){if(this.hasOwnProperty(Wt("elementProperties")))return;let t=gn(this);t.finalize(),t.l!==void 0&&(this.l=[...t.l]),this.elementProperties=new Map(t.elementProperties)}static finalize(){if(this.hasOwnProperty(Wt("finalized")))return;if(this.finalized=!0,this._$Ei(),this.hasOwnProperty(Wt("properties"))){let e=this.properties,o=[...pn(e),...fn(e)];for(let i of o)this.createProperty(i,e[i])}let t=this[Symbol.metadata];if(t!==null){let e=litPropertyMetadata.get(t);if(e!==void 0)for(let[o,i]of e)this.elementProperties.set(o,i)}this._$Eh=new Map;for(let[e,o]of this.elementProperties){let i=this._$Eu(e,o);i!==void 0&&this._$Eh.set(i,e)}this.elementStyles=this.finalizeStyles(this.styles)}static finalizeStyles(t){let e=[];if(Array.isArray(t)){let o=new Set(t.flat(1/0).reverse());for(let i of o)e.unshift(Be(i))}else t!==void 0&&e.push(Be(t));return e}static _$Eu(t,e){let o=e.attribute;return o===!1?void 0:typeof o=="string"?o:typeof t=="string"?t.toLowerCase():void 0}constructor(){super(),this._$Ep=void 0,this.isUpdatePending=!1,this.hasUpdated=!1,this._$Em=null,this._$Ev()}_$Ev(){this._$ES=new Promise((t)=>this.enableUpdating=t),this._$AL=new Map,this._$E_(),this.requestUpdate(),this.constructor.l?.forEach((t)=>t(this))}addController(t){(this._$EO??=new Set).add(t),this.renderRoot!==void 0&&this.isConnected&&t.hostConnected?.()}removeController(t){this._$EO?.delete(t)}_$E_(){let t=new Map,e=this.constructor.elementProperties;for(let o of e.keys())this.hasOwnProperty(o)&&(t.set(o,this[o]),delete this[o]);t.size>0&&(this._$Ep=t)}createRenderRoot(){let t=this.shadowRoot??this.attachShadow(this.constructor.shadowRootOptions);return zo(t,this.constructor.elementStyles),t}connectedCallback(){this.renderRoot??=this.createRenderRoot(),this.enableUpdating(!0),this._$EO?.forEach((t)=>t.hostConnected?.())}enableUpdating(t){}disconnectedCallback(){this._$EO?.forEach((t)=>t.hostDisconnected?.())}attributeChangedCallback(t,e,o){this._$AK(t,o)}_$ET(t,e){let o=this.constructor.elementProperties.get(t),i=this.constructor._$Eu(t,o);if(i!==void 0&&o.reflect===!0){let n=(o.converter?.toAttribute!==void 0?o.converter:jt).toAttribute(e,o.type);this._$Em=t,n==null?this.removeAttribute(i):this.setAttribute(i,n),this._$Em=null}}_$AK(t,e){let o=this.constructor,i=o._$Eh.get(t);if(i!==void 0&&this._$Em!==i){let n=o.getPropertyOptions(i),r=typeof n.converter=="function"?{fromAttribute:n.converter}:n.converter?.fromAttribute!==void 0?n.converter:jt;this._$Em=i;let a=r.fromAttribute(e,n.type);this[i]=a??this._$Ej?.get(i)??a,this._$Em=null}}requestUpdate(t,e,o,i=!1,n){if(t!==void 0){let r=this.constructor;if(i===!1&&(n=this[t]),o??=r.getPropertyOptions(t),!((o.hasChanged??me)(n,e)||o.useDefault&&o.reflect&&n===this._$Ej?.get(t)&&!this.hasAttribute(r._$Eu(t,o))))return;this.C(t,e,o)}this.isUpdatePending===!1&&(this._$ES=this._$EP())}C(t,e,{useDefault:o,reflect:i,wrapped:n},r){o&&!(this._$Ej??=new Map).has(t)&&(this._$Ej.set(t,r??e??this[t]),n!==!0||r!==void 0)||(this._$AL.has(t)||(this.hasUpdated||o||(e=void 0),this._$AL.set(t,e)),i===!0&&this._$Em!==t&&(this._$Eq??=new Set).add(t))}async _$EP(){this.isUpdatePending=!0;try{await this._$ES}catch(e){Promise.reject(e)}let t=this.scheduleUpdate();return t!=null&&await t,!this.isUpdatePending}scheduleUpdate(){return this.performUpdate()}performUpdate(){if(!this.isUpdatePending)return;if(!this.hasUpdated){if(this.renderRoot??=this.createRenderRoot(),this._$Ep){for(let[i,n]of this._$Ep)this[i]=n;this._$Ep=void 0}let o=this.constructor.elementProperties;if(o.size>0)for(let[i,n]of o){let{wrapped:r}=n,a=this[i];r!==!0||this._$AL.has(i)||a===void 0||this.C(i,void 0,n,a)}}let t=!1,e=this._$AL;try{t=this.shouldUpdate(e),t?(this.willUpdate(e),this._$EO?.forEach((o)=>o.hostUpdate?.()),this.update(e)):this._$EM()}catch(o){throw t=!1,this._$EM(),o}t&&this._$AE(e)}willUpdate(t){}_$AE(t){this._$EO?.forEach((e)=>e.hostUpdated?.()),this.hasUpdated||(this.hasUpdated=!0,this.firstUpdated(t)),this.updated(t)}_$EM(){this._$AL=new Map,this.isUpdatePending=!1}get updateComplete(){return this.getUpdateComplete()}getUpdateComplete(){return this._$ES}shouldUpdate(t){return!0}update(t){this._$Eq&&=this._$Eq.forEach((e)=>this._$ET(e,this[e])),this._$EM()}updated(t){}firstUpdated(t){}}mt.elementStyles=[],mt.shadowRootOptions={mode:"open"},mt[Wt("elementProperties")]=new Map,mt[Wt("finalized")]=new Map,wn?.({ReactiveElement:mt}),(ue.reactiveElementVersions??=[]).push("2.1.2");var Ne=globalThis,Po=(t)=>t,he=Ne.trustedTypes,Fo=he?he.createPolicy("lit-html",{createHTML:(t)=>t}):void 0;var at=`lit$${Math.random().toFixed(9).slice(2)}$`,qe="?"+at,bn=`<${qe}>`,Ct=document,Yt=()=>Ct.createComment(""),Kt=(t)=>t===null||typeof t!="object"&&typeof t!="function",Ue=Array.isArray,Do=(t)=>Ue(t)||typeof t?.[Symbol.iterator]=="function";var Xt=/<(?:(!--|\/[^a-zA-Z])|(\/?[a-zA-Z][^>\s]*)|(\/?$))/g,Mo=/-->/g,Ro=/>/g,bt=RegExp(`>|[ 	
\f\r](?:([^\\s"'>=/]+)([ 	
\f\r]*=[ 	
\f\r]*(?:[^ 	
\f\r"'\`<>=]|("|')|))|$)`,"g"),Oo=/'/g,To=/"/g,Bo=/^(?:script|style|textarea|title)$/i,He=(t)=>(e,...o)=>({_$litType$:t,strings:e,values:o}),A=He(1),No=He(2),qo=He(3),st=Symbol.for("lit-noChange"),P=Symbol.for("lit-nothing"),Io=new WeakMap,yt=Ct.createTreeWalker(Ct,129);function Uo(t,e){if(!Ue(t)||!t.hasOwnProperty("raw"))throw Error("invalid template strings array");return Fo!==void 0?Fo.createHTML(e):e}var Ho=(t,e)=>{let o=t.length-1,i=[],n,r=e===2?"<svg>":e===3?"<math>":"",a=Xt;for(let s=0;s<o;s++){let d=t[s],u,c,h=-1,p=0;for(;p<d.length&&(a.lastIndex=p,c=a.exec(d),c!==null);)p=a.lastIndex,a===Xt?c[1]==="!--"?a=Mo:c[1]!==void 0?a=Ro:c[2]!==void 0?(Bo.test(c[2])&&(n=RegExp("</"+c[2],"g")),a=bt):c[3]!==void 0&&(a=bt):a===bt?c[0]===">"?(a=n??Xt,h=-1):c[1]===void 0?h=-2:(h=a.lastIndex-c[2].length,u=c[1],a=c[3]===void 0?bt:c[3]==='"'?To:Oo):a===To||a===Oo?a=bt:a===Mo||a===Ro?a=Xt:(a=bt,n=void 0);let f=a===bt&&t[s+1].startsWith("/>")?" ":"";r+=a===Xt?d+bn:h>=0?(i.push(u),d.slice(0,h)+"$lit$"+d.slice(h)+at+f):d+at+(h===-2?s:f)}return[Uo(t,r+(t[o]||"<?>")+(e===2?"</svg>":e===3?"</math>":"")),i]};class Gt{constructor({strings:t,_$litType$:e},o){let i;this.parts=[];let n=0,r=0,a=t.length-1,s=this.parts,[d,u]=Ho(t,e);if(this.el=Gt.createElement(d,o),yt.currentNode=this.el.content,e===2||e===3){let c=this.el.content.firstChild;c.replaceWith(...c.childNodes)}for(;(i=yt.nextNode())!==null&&s.length<a;){if(i.nodeType===1){if(i.hasAttributes())for(let c of i.getAttributeNames())if(c.endsWith("$lit$")){let h=u[r++],p=i.getAttribute(c).split(at),f=/([.?@])?(.*)/.exec(h);s.push({type:1,index:n,name:f[2],strings:p,ctor:f[1]==="."?We:f[1]==="?"?je:f[1]==="@"?Xe:Tt}),i.removeAttribute(c)}else c.startsWith(at)&&(s.push({type:6,index:n}),i.removeAttribute(c));if(Bo.test(i.tagName)){let c=i.textContent.split(at),h=c.length-1;if(h>0){i.textContent=he?he.emptyScript:"";for(let p=0;p<h;p++)i.append(c[p],Yt()),yt.nextNode(),s.push({type:2,index:++n});i.append(c[h],Yt())}}}else if(i.nodeType===8)if(i.data===qe)s.push({type:2,index:n});else{let c=-1;for(;(c=i.data.indexOf(at,c+1))!==-1;)s.push({type:7,index:n}),c+=at.length-1}n++}}static createElement(t,e){let o=Ct.createElement("template");return o.innerHTML=t,o}}function xt(t,e,o=t,i){if(e===st)return e;let n=i!==void 0?o._$Co?.[i]:o._$Cl,r=Kt(e)?void 0:e._$litDirective$;return n?.constructor!==r&&(n?._$AO?.(!1),r===void 0?n=void 0:(n=new r(t),n._$AT(t,o,i)),i!==void 0?(o._$Co??=[])[i]=n:o._$Cl=n),n!==void 0&&(e=xt(t,n._$AS(t,e.values),n,i)),e}class Ve{constructor(t,e){this._$AV=[],this._$AN=void 0,this._$AD=t,this._$AM=e}get parentNode(){return this._$AM.parentNode}get _$AU(){return this._$AM._$AU}u(t){let{el:{content:e},parts:o}=this._$AD,i=(t?.creationScope??Ct).importNode(e,!0);yt.currentNode=i;let n=yt.nextNode(),r=0,a=0,s=o[0];for(;s!==void 0;){if(r===s.index){let d;s.type===2?d=new Ot(n,n.nextSibling,this,t):s.type===1?d=new s.ctor(n,s.name,s.strings,this,t):s.type===6&&(d=new Ye(n,this,t)),this._$AV.push(d),s=o[++a]}r!==s?.index&&(n=yt.nextNode(),r++)}return yt.currentNode=Ct,i}p(t){let e=0;for(let o of this._$AV)o!==void 0&&(o.strings!==void 0?(o._$AI(t,o,e),e+=o.strings.length-2):o._$AI(t[e])),e++}}class Ot{get _$AU(){return this._$AM?._$AU??this._$Cv}constructor(t,e,o,i){this.type=2,this._$AH=P,this._$AN=void 0,this._$AA=t,this._$AB=e,this._$AM=o,this.options=i,this._$Cv=i?.isConnected??!0}get parentNode(){let t=this._$AA.parentNode,e=this._$AM;return e!==void 0&&t?.nodeType===11&&(t=e.parentNode),t}get startNode(){return this._$AA}get endNode(){return this._$AB}_$AI(t,e=this){t=xt(this,t,e),Kt(t)?t===P||t==null||t===""?(this._$AH!==P&&this._$AR(),this._$AH=P):t!==this._$AH&&t!==st&&this._(t):t._$litType$!==void 0?this.$(t):t.nodeType!==void 0?this.T(t):Do(t)?this.k(t):this._(t)}O(t){return this._$AA.parentNode.insertBefore(t,this._$AB)}T(t){this._$AH!==t&&(this._$AR(),this._$AH=this.O(t))}_(t){this._$AH!==P&&Kt(this._$AH)?this._$AA.nextSibling.data=t:this.T(Ct.createTextNode(t)),this._$AH=t}$(t){let{values:e,_$litType$:o}=t,i=typeof o=="number"?this._$AC(t):(o.el===void 0&&(o.el=Gt.createElement(Uo(o.h,o.h[0]),this.options)),o);if(this._$AH?._$AD===i)this._$AH.p(e);else{let n=new Ve(i,this),r=n.u(this.options);n.p(e),this.T(r),this._$AH=n}}_$AC(t){let e=Io.get(t.strings);return e===void 0&&Io.set(t.strings,e=new Gt(t)),e}k(t){Ue(this._$AH)||(this._$AH=[],this._$AR());let e=this._$AH,o,i=0;for(let n of t)i===e.length?e.push(o=new Ot(this.O(Yt()),this.O(Yt()),this,this.options)):o=e[i],o._$AI(n),i++;i<e.length&&(this._$AR(o&&o._$AB.nextSibling,i),e.length=i)}_$AR(t=this._$AA.nextSibling,e){for(this._$AP?.(!1,!0,e);t!==this._$AB;){let o=Po(t).nextSibling;Po(t).remove(),t=o}}setConnected(t){this._$AM===void 0&&(this._$Cv=t,this._$AP?.(t))}}class Tt{get tagName(){return this.element.tagName}get _$AU(){return this._$AM._$AU}constructor(t,e,o,i,n){this.type=1,this._$AH=P,this._$AN=void 0,this.element=t,this.name=e,this._$AM=i,this.options=n,o.length>2||o[0]!==""||o[1]!==""?(this._$AH=Array(o.length-1).fill(new String),this.strings=o):this._$AH=P}_$AI(t,e=this,o,i){let n=this.strings,r=!1;if(n===void 0)t=xt(this,t,e,0),r=!Kt(t)||t!==this._$AH&&t!==st,r&&(this._$AH=t);else{let a=t,s,d;for(t=n[0],s=0;s<n.length-1;s++)d=xt(this,a[o+s],e,s),d===st&&(d=this._$AH[s]),r||=!Kt(d)||d!==this._$AH[s],d===P?t=P:t!==P&&(t+=(d??"")+n[s+1]),this._$AH[s]=d}r&&!i&&this.j(t)}j(t){t===P?this.element.removeAttribute(this.name):this.element.setAttribute(this.name,t??"")}}class We extends Tt{constructor(){super(...arguments),this.type=3}j(t){this.element[this.name]=t===P?void 0:t}}class je extends Tt{constructor(){super(...arguments),this.type=4}j(t){this.element.toggleAttribute(this.name,!!t&&t!==P)}}class Xe extends Tt{constructor(t,e,o,i,n){super(t,e,o,i,n),this.type=5}_$AI(t,e=this){if((t=xt(this,t,e,0)??P)===st)return;let o=this._$AH,i=t===P&&o!==P||t.capture!==o.capture||t.once!==o.once||t.passive!==o.passive,n=t!==P&&(o===P||i);i&&this.element.removeEventListener(this.name,this,o),n&&this.element.addEventListener(this.name,this,t),this._$AH=t}handleEvent(t){typeof this._$AH=="function"?this._$AH.call(this.options?.host??this.element,t):this._$AH.handleEvent(t)}}class Ye{constructor(t,e,o){this.element=t,this.type=6,this._$AN=void 0,this._$AM=e,this.options=o}get _$AU(){return this._$AM._$AU}_$AI(t){xt(this,t)}}var Vo={M:"$lit$",P:at,A:qe,C:1,L:Ho,R:Ve,D:Do,V:xt,I:Ot,H:Tt,N:je,U:Xe,B:We,F:Ye},yn=Ne.litHtmlPolyfillSupport;yn?.(Gt,Ot),(Ne.litHtmlVersions??=[]).push("3.3.3");var Wo=(t,e,o)=>{let i=o?.renderBefore??e,n=i._$litPart$;if(n===void 0){let r=o?.renderBefore??null;i._$litPart$=n=new Ot(e.insertBefore(Yt(),r),r,void 0,o??{})}return n._$AI(t),n};var Ke=globalThis;class Lt extends mt{constructor(){super(...arguments),this.renderOptions={host:this},this._$Do=void 0}createRenderRoot(){let t=super.createRenderRoot();return this.renderOptions.renderBefore??=t.firstChild,t}update(t){let e=this.render();this.hasUpdated||(this.renderOptions.isConnected=this.isConnected),super.update(t),this._$Do=Wo(e,this.renderRoot,this.renderOptions)}connectedCallback(){super.connectedCallback(),this._$Do?.setConnected(!0)}disconnectedCallback(){super.disconnectedCallback(),this._$Do?.setConnected(!1)}render(){return st}}Lt._$litElement$=!0,Lt.finalized=!0,Ke.litElementHydrateSupport?.({LitElement:Lt});var Cn=Ke.litElementPolyfillSupport;Cn?.({LitElement:Lt});(Ke.litElementVersions??=[]).push("4.2.2");var Z=!1;var F=(t)=>(e,o)=>{o!==void 0?o.addInitializer(()=>{customElements.define(t,e)}):customElements.define(t,e)};var xn={attribute:!0,type:String,converter:jt,reflect:!1,hasChanged:me},Ln=(t=xn,e,o)=>{let{kind:i,metadata:n}=o,r=globalThis.litPropertyMetadata.get(n);if(r===void 0&&globalThis.litPropertyMetadata.set(n,r=new Map),i==="setter"&&((t=Object.create(t)).wrapped=!0),r.set(o.name,t),i==="accessor"){let{name:a}=o;return{set(s){let d=e.get.call(this);e.set.call(this,s),this.requestUpdate(a,d,t,!0,s)},init(s){return s!==void 0&&this.C(a,void 0,t,s),s}}}if(i==="setter"){let{name:a}=o;return function(s){let d=this[a];e.call(this,s),this.requestUpdate(a,d,t,!0,s)}}throw Error("Unsupported decorator location: "+i)};function m(t){return(e,o)=>typeof o=="object"?Ln(t,e,o):((i,n,r)=>{let a=n.hasOwnProperty(r);return n.constructor.createProperty(r,i),a?Object.getOwnPropertyDescriptor(n,r):void 0})(t,e,o)}function St(t){return m({...t,state:!0,attribute:!1})}var At=(t,e,o)=>(o.configurable=!0,o.enumerable=!0,Reflect.decorate&&typeof e!="object"&&Object.defineProperty(t,e,o),o);function D(t,e){return(o,i,n)=>{let r=(a)=>a.renderRoot?.querySelector(t)??null;if(e){let{get:a,set:s}=typeof i=="object"?o:n??(()=>{let d=Symbol();return{get(){return this[d]},set(u){this[d]=u}}})();return At(o,i,{get(){let d=a.call(this);return d===void 0&&(d=r(this),(d!==null||this.hasUpdated)&&s.call(this,d)),d}})}return At(o,i,{get(){return r(this)}})}}/*! Copyright 2026 Fonticons, Inc. - https://webawesome.com/license */var Sn=S`
  :host {
    box-sizing: border-box;
  }

  :host *,
  :host *::before,
  :host *::after {
    box-sizing: inherit;
  }

  [hidden],
  :host([hidden]) {
    display: none !important;
  }
`,An=/;\s+$/;function En(t){return t.replace(/[A-Z]/g,(e)=>`-${e.toLowerCase()}`)}function jo(t){let{property:e,value:o,element:i}=t;if(o){let n=i.getAttribute("style")||"";if(n){if(!n.match(An))n+=";";n+=" "}let r=`${e}: ${o}`;if(n.includes(r))return;return`${n}${r};`}return null}var pe,_=class extends Lt{constructor(){super();So(this,pe,!1),this.initialReflectedProperties=new Map,this.didSSR=Z||Boolean(this.shadowRoot),this.customStates={set:(e,o)=>{if(!Boolean(this.internals?.states))return;try{if(o)this.internals.states.add(e);else this.internals.states.delete(e)}catch(i){if(String(i).includes("must start with '--'"))console.error("Your browser implements an outdated version of CustomStateSet. Consider using a polyfill");else throw i}},has:(e)=>{if(!Boolean(this.internals?.states))return!1;try{return this.internals.states.has(e)}catch{return!1}}};try{this.internals=this.attachInternals()}catch{console.error("Element internals are not supported in your browser. Consider using a polyfill")}this.customStates.set("wa-defined",!0);let t=this.constructor;for(let[e,o]of t.elementProperties)if(o.default==="inherit"&&o.initial!==void 0&&typeof e==="string")this.customStates.set(`initial-${e}-${o.initial}`,!0)}static get styles(){let t=Array.isArray(this.css)?this.css:this.css?[this.css]:[];return[Sn,...t]}connectedCallback(){if(super.connectedCallback(),!this.didSSR)this.shadowRoot?.prepend(document.createComment(` Web Awesome: https://webawesome.com/docs/components/${this.localName.replace("wa-","")} `));if(this.didSSR)this.updateComplete.then(()=>{this.shadowRoot?.prepend(document.createComment(` Web Awesome: https://webawesome.com/docs/components/${this.localName.replace("wa-","")} `))})}attributeChangedCallback(t,e,o){if(!Lo(this,pe))this.constructor.elementProperties.forEach((i,n)=>{if(i.reflect&&this[n]!=null)this.initialReflectedProperties.set(n,this[n])}),Ao(this,pe,!0);super.attributeChangedCallback(t,e,o)}willUpdate(t){super.willUpdate(t),this.initialReflectedProperties.forEach((e,o)=>{if(t.has(o)&&this[o]==null)this[o]=e})}firstUpdated(t){if(super.firstUpdated(t),this.didSSR)this.shadowRoot?.querySelectorAll("slot").forEach((e)=>{e.dispatchEvent(new Event("slotchange",{bubbles:!0,composed:!1,cancelable:!1}))})}update(t){try{super.update(t)}catch(e){if(this.didSSR&&!this.hasUpdated){let o=new Event("lit-hydration-error",{bubbles:!0,composed:!0,cancelable:!1});o.error=e,this.dispatchEvent(o)}throw e}}setStyle(t,e){if(!this.style){let o=jo({property:En(t),value:e,element:this});if(o)this.setAttribute("style",o);return}this.style[t]=e}setStyleProperty(t,e){if(!this.style){let o=jo({property:t,value:e,element:this});if(o)this.setAttribute("style",o);return}this.style.setProperty(t,e)}relayNativeEvent(t,e){t.stopImmediatePropagation(),this.dispatchEvent(new t.constructor(t.type,{...t,...e}))}};pe=new WeakMap;l([m()],_.prototype,"dir",2);l([m()],_.prototype,"lang",2);l([m({type:Boolean,reflect:!0,attribute:"did-ssr"})],_.prototype,"didSSR",2);/*! Copyright 2026 Fonticons, Inc. - https://webawesome.com/license */var $n=()=>({observedAttributes:["custom-error"],checkValidity(t){let e={message:"",isValid:!0,invalidKeys:[]};if(t.customError)e.message=t.customError,e.isValid=!1,e.invalidKeys=["customError"];return e}}),J=class extends _{constructor(){super();if(this.name=null,this.disabled=!1,this.required=!1,this.assumeInteractionOn=["input"],this.validators=[],this.valueHasChanged=!1,this.hasInteracted=!1,this.customError=null,this.emittedEvents=[],this.emitInvalid=(t)=>{if(t.target!==this)return;this.hasInteracted=!0,this.dispatchEvent(new se)},this.handleInteraction=(t)=>{let e=this.emittedEvents;if(!e.includes(t.type))e.push(t.type);if(e.length===this.assumeInteractionOn?.length)this.hasInteracted=!0},"addEventListener"in this)this.addEventListener("invalid",this.emitInvalid)}static get validators(){return Z?[]:[$n()]}static get observedAttributes(){let t=new Set(super.observedAttributes||[]);for(let e of this.validators){if(!e.observedAttributes)continue;for(let o of e.observedAttributes)t.add(o)}return[...t]}connectedCallback(){if(super.connectedCallback(),this.didSSR&&!this.hasUpdated)this.updateComplete.then(()=>{this.updateValidity()});else this.updateValidity();this.assumeInteractionOn.forEach((t)=>{this.addEventListener?.(t,this.handleInteraction)})}firstUpdated(...t){super.firstUpdated(...t),this.updateValidity()}willUpdate(t){if(!Z&&t.has("customError")){if(!this.customError)this.customError=null;this.setCustomValidity(this.customError||"")}if(t.has("value")||t.has("disabled")||t.has("defaultValue")){let e=this.value;this.updateFormValue(e)}if(t.has("disabled")){if(this.customStates.set("disabled",this.disabled),this.hasAttribute("disabled")||!Z&&!this.matches(":disabled"))this.toggleAttribute("disabled",this.disabled)}if(super.willUpdate(t),this.didSSR&&!this.hasUpdated)this.updateComplete.then(()=>this.updateValidity());else this.updateValidity()}updateFormValue(t){if(Array.isArray(t)){if(this.name){let e=new FormData;for(let o of t)e.append(this.name,o);this.setValue(e,e)}}else this.setValue(t,t)}get labels(){return this.internals.labels}getForm(){return this.internals.form}set form(t){if(t)this.setAttribute("form",t);else this.removeAttribute("form")}get form(){return this.internals.form}get validity(){return this.internals.validity}get willValidate(){return this.internals.willValidate}get validationMessage(){return this.internals.validationMessage}checkValidity(){return this.updateValidity(),this.internals.checkValidity()}reportValidity(){return this.updateValidity(),this.hasInteracted=!0,this.internals.reportValidity()}get validationTarget(){return this.input||void 0}setValidity(...t){let e=t[0],o=t[1],i=t[2];if(!i)i=this.validationTarget;this.internals.setValidity(e,o,i||void 0),this.requestUpdate("validity"),this.setCustomStates()}setCustomStates(){let t=Boolean(this.required),e=this.internals.validity.valid,o=this.hasInteracted;this.customStates.set("required",t),this.customStates.set("optional",!t),this.customStates.set("invalid",!e),this.customStates.set("valid",e),this.customStates.set("user-invalid",!e&&o),this.customStates.set("user-valid",e&&o)}setCustomValidity(t){if(!t){this.customError=null,this.setValidity({});return}this.customError=t,this.setValidity({customError:!0},t,this.validationTarget)}formResetCallback(){this.resetValidity(),this.hasInteracted=!1,this.valueHasChanged=!1,this.emittedEvents=[],this.updateValidity()}formDisabledCallback(t){this.disabled=t,this.updateValidity()}formStateRestoreCallback(t,e){if(this.didSSR&&!this.hasUpdated)this.updateComplete.then(()=>{if(this.value=t,e==="restore")this.resetValidity();this.updateValidity()});else{if(this.value=t,e==="restore")this.resetValidity();this.updateValidity()}}setValue(...t){let[e,o]=t;this.internals.setFormValue(e,o)}get allValidators(){let t=this.constructor.validators||[],e=this.validators||[];return[...t,...e]}resetValidity(){this.setCustomValidity(""),this.setValidity({})}updateValidity(){if(this.disabled||this.hasAttribute("disabled")||!this.willValidate){this.resetValidity();return}let t=this.allValidators;if(!t?.length)return;let e={customError:Boolean(this.customError)},o=this.validationTarget||this.input||void 0,i="";for(let n of t){let{isValid:r,message:a,invalidKeys:s}=n.checkValidity(this);if(r)continue;if(!i)i=a;if(s?.length>=0)s.forEach((d)=>e[d]=!0)}if(!i)i=this.validationMessage;this.setValidity(e,i,o)}};J.formAssociated=!0;l([m({reflect:!0})],J.prototype,"name",2);l([m({type:Boolean})],J.prototype,"disabled",2);l([m({state:!0,attribute:!1})],J.prototype,"valueHasChanged",2);l([m({state:!0,attribute:!1})],J.prototype,"hasInteracted",2);l([m({attribute:"custom-error",reflect:!0})],J.prototype,"customError",2);l([m({attribute:!1,state:!0,type:Object})],J.prototype,"validity",1);/*! Copyright 2026 Fonticons, Inc. - https://webawesome.com/license */var Xo={small:"s",medium:"m",large:"l"},Yo=new Set;function It(t,e){if(e in Xo&&!Yo.has(`${t}:${e}`))Yo.add(`${t}:${e}`),console.warn(`[${t}] size="${e}" is deprecated. Use size="${Xo[e]}" instead. The long-form value will be removed in the next major version.`)}/*! Copyright 2026 Fonticons, Inc. - https://webawesome.com/license */var ht=class{constructor(t,...e){this.slotNames=[],this.handleSlotChange=(o)=>{let i=o.target;if(this.slotNames.includes("[default]")&&!i.name||i.name&&this.slotNames.includes(i.name))this.host.requestUpdate()},(this.host=t).addController(this),this.slotNames=e}hasDefaultSlot(){if(!this.host.childNodes)return!1;return[...this.host.childNodes].some((t)=>{if(t.nodeType===Node.TEXT_NODE&&t.textContent.trim()!=="")return!0;if(t.nodeType===Node.ELEMENT_NODE){let e=t;if(e.tagName.toLowerCase()==="wa-visually-hidden")return!1;if(!e.hasAttribute("slot"))return!0}return!1})}hasNamedSlot(t){return this.host.querySelector?.(`:scope > [slot="${t}"]`)!==null}test(t,e){if(e&&this.host.didSSR&&!this.host.hasUpdated)return Boolean(this.host[e]);return t==="[default]"?this.hasDefaultSlot():this.hasNamedSlot(t)}hostConnected(){let t=this.host.shadowRoot;if(t&&"addEventListener"in t)t.addEventListener("slotchange",this.handleSlotChange)}hostDisconnected(){let t=this.host.shadowRoot;if(t&&"removeEventListener"in t)t.removeEventListener("slotchange",this.handleSlotChange)}};/*! Copyright 2026 Fonticons, Inc. - https://webawesome.com/license */var fe=S`
  :host([size='xs']) {
    font-size: var(--wa-font-size-xs);
  }

  :host([size='s']),
  :host([size='small']) {
    font-size: var(--wa-font-size-s);
  }

  :host([size='m']),
  :host([size='medium']) {
    font-size: var(--wa-font-size-m);
  }

  :host([size='l']),
  :host([size='large']) {
    font-size: var(--wa-font-size-l);
  }

  :host([size='xl']) {
    font-size: var(--wa-font-size-xl);
  }
`;/*! Copyright 2026 Fonticons, Inc. - https://webawesome.com/license */var Ko=S`
  @layer wa-component {
    :host {
      display: inline-block;

      /* Workaround because Chrome doesn't like :host(:has()) below
       * https://issues.chromium.org/issues/40062355
       * Firefox doesn't like this nested rule, so both are needed */
      &:has(wa-badge) {
        position: relative;
      }
    }

    /* Apply relative positioning only when needed to position wa-badge
     * This avoids creating a new stacking context for every button */
    :host(:has(wa-badge)) {
      position: relative;
    }
  }

  .button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    text-decoration: none;
    user-select: none;
    -webkit-user-select: none;
    white-space: nowrap;
    vertical-align: middle;
    transition-property: background, border, box-shadow, color, opacity, transform;
    transition-duration: var(--wa-transition-fast);
    transition-timing-function: var(--wa-transition-easing);
    transform-origin: center;
    cursor: pointer;
    padding: 0 var(--wa-form-control-padding-inline);
    font-family: inherit;
    font-size: inherit;
    font-weight: var(--wa-font-weight-action);
    height: var(--wa-form-control-height);
    width: 100%;

    background-color: var(--wa-color-fill-loud, var(--wa-color-neutral-fill-loud));

    border-color: transparent;
    color: var(--wa-color-on-loud, var(--wa-color-neutral-on-loud));
    border-start-start-radius: var(--_button-start-start-radius, var(--wa-form-control-border-radius));
    border-start-end-radius: var(--_button-start-end-radius, var(--wa-form-control-border-radius));
    border-end-start-radius: var(--_button-end-start-radius, var(--wa-form-control-border-radius));
    border-end-end-radius: var(--_button-end-end-radius, var(--wa-form-control-border-radius));
    border-style: var(--wa-form-control-border-style);
    border-width: var(--wa-form-control-border-width);
  }

  /* Hover and active transforms */
  .button:not(.disabled):not(.loading) {
    @media (hover: hover) {
      &:hover {
        transform: var(--wa-button-transform-hover);
      }
    }
    &:active {
      transform: var(--wa-button-transform-active);
    }

    @media (prefers-reduced-motion: reduce) {
      &:hover,
      &:active {
        transform: none;
      }
    }
  }

  /* Appearance modifiers */
  :host([appearance='plain']) {
    /* Indentation overrides for grouping */
    margin-inline-start: var(--_button-horizontal-indent);
    margin-block-start: var(--_button-vertical-indent);

    .button {
      color: var(--wa-color-on-quiet, var(--wa-color-neutral-on-quiet));
      background-color: transparent;
      border-color: transparent;
    }
    @media (hover: hover) {
      .button:not(.disabled):not(.loading):hover {
        color: var(--wa-color-on-quiet, var(--wa-color-neutral-on-quiet));
        background-color: var(--wa-color-fill-quiet, var(--wa-color-neutral-fill-quiet));
      }
    }
    .button:not(.disabled):not(.loading):active {
      color: var(--wa-color-on-quiet, var(--wa-color-neutral-on-quiet));
      background-color: color-mix(
        in oklab,
        var(--wa-color-fill-quiet, var(--wa-color-neutral-fill-quiet)),
        var(--wa-color-mix-active)
      );
    }
  }

  :host([appearance='outlined']) {
    /* Indentation overrides for grouping outlined */
    margin-inline-start: var(--_button-horizontal-indent-outlined);
    margin-block-start: var(--_button-vertical-indent-outlined);

    .button {
      color: var(--wa-color-on-quiet, var(--wa-color-neutral-on-quiet));
      background-color: transparent;
      border-color: var(--wa-color-border-loud, var(--wa-color-neutral-border-loud));
    }
    @media (hover: hover) {
      .button:not(.disabled):not(.loading):hover {
        color: var(--wa-color-on-quiet, var(--wa-color-neutral-on-quiet));
        background-color: var(--wa-color-fill-quiet, var(--wa-color-neutral-fill-quiet));
      }
    }
    .button:not(.disabled):not(.loading):active {
      color: var(--wa-color-on-quiet, var(--wa-color-neutral-on-quiet));
      background-color: color-mix(
        in oklab,
        var(--wa-color-fill-quiet, var(--wa-color-neutral-fill-quiet)),
        var(--wa-color-mix-active)
      );
    }
  }

  :host([appearance='filled']) {
    /* Indentation overrides for grouping */
    margin-inline-start: var(--_button-horizontal-indent);
    margin-block-start: var(--_button-vertical-indent);

    .button {
      color: var(--wa-color-on-normal, var(--wa-color-neutral-on-normal));
      background-color: var(--wa-color-fill-normal, var(--wa-color-neutral-fill-normal));
      border-color: transparent;
    }
    @media (hover: hover) {
      .button:not(.disabled):not(.loading):hover {
        color: var(--wa-color-on-normal, var(--wa-color-neutral-on-normal));
        background-color: color-mix(
          in oklab,
          var(--wa-color-fill-normal, var(--wa-color-neutral-fill-normal)),
          var(--wa-color-mix-hover)
        );
      }
    }
    .button:not(.disabled):not(.loading):active {
      color: var(--wa-color-on-normal, var(--wa-color-neutral-on-normal));
      background-color: color-mix(
        in oklab,
        var(--wa-color-fill-normal, var(--wa-color-neutral-fill-normal)),
        var(--wa-color-mix-active)
      );
    }
  }

  :host([appearance='filled-outlined']) {
    /* Indentation overrides for grouping outlined */
    margin-inline-start: var(--_button-horizontal-indent-outlined);
    margin-block-start: var(--_button-vertical-indent-outlined);

    .button {
      color: var(--wa-color-on-normal, var(--wa-color-neutral-on-normal));
      background-color: var(--wa-color-fill-normal, var(--wa-color-neutral-fill-normal));
      border-color: var(--wa-color-border-normal, var(--wa-color-neutral-border-normal));
    }
    @media (hover: hover) {
      .button:not(.disabled):not(.loading):hover {
        color: var(--wa-color-on-normal, var(--wa-color-neutral-on-normal));
        background-color: color-mix(
          in oklab,
          var(--wa-color-fill-normal, var(--wa-color-neutral-fill-normal)),
          var(--wa-color-mix-hover)
        );
      }
    }
    .button:not(.disabled):not(.loading):active {
      color: var(--wa-color-on-normal, var(--wa-color-neutral-on-normal));
      background-color: color-mix(
        in oklab,
        var(--wa-color-fill-normal, var(--wa-color-neutral-fill-normal)),
        var(--wa-color-mix-active)
      );
    }
  }

  :host([appearance='accent']) {
    /* Indentation overrides for grouping */
    margin-inline-start: var(--_button-horizontal-indent);
    margin-block-start: var(--_button-vertical-indent);

    .button {
      color: var(--wa-color-on-loud, var(--wa-color-neutral-on-loud));
      background-color: var(--wa-color-fill-loud, var(--wa-color-neutral-fill-loud));
      border-color: transparent;
    }
    @media (hover: hover) {
      .button:not(.disabled):not(.loading):hover {
        background-color: color-mix(
          in oklab,
          var(--wa-color-fill-loud, var(--wa-color-neutral-fill-loud)),
          var(--wa-color-mix-hover)
        );
      }
    }
    .button:not(.disabled):not(.loading):active {
      background-color: color-mix(
        in oklab,
        var(--wa-color-fill-loud, var(--wa-color-neutral-fill-loud)),
        var(--wa-color-mix-active)
      );
    }
  }

  /* Focus states */
  .button:focus {
    outline: none;
  }

  .button:focus-visible {
    outline: var(--wa-focus-ring);
    outline-offset: var(--wa-focus-ring-offset);
  }

  /* Disabled state */
  :host([disabled]) {
    opacity: 0.5;
    cursor: not-allowed;

    /* When disabled, prevent mouse events from bubbling up from children */
    .button {
      pointer-events: none;
    }
  }

  /* Keep it last so Safari doesn't stop parsing this block */
  .button::-moz-focus-inner {
    border: 0;
  }

  /* Icon buttons */
  .button.is-icon-button {
    outline-offset: 2px;
    width: var(--wa-form-control-height);
    aspect-ratio: 1;
  }

  /* Icon buttons with a caret need to grow to fit both the icon and the caret */
  .button.is-icon-button.caret {
    width: auto;
    aspect-ratio: auto;
    min-width: var(--wa-form-control-height);
  }

  /* Pill modifier */
  :host([pill]) .button {
    border-start-start-radius: var(--_button-start-start-radius, var(--wa-border-radius-pill));
    border-start-end-radius: var(--_button-start-end-radius, var(--wa-border-radius-pill));
    border-end-start-radius: var(--_button-end-start-radius, var(--wa-border-radius-pill));
    border-end-end-radius: var(--_button-end-end-radius, var(--wa-border-radius-pill));
  }

  /*
   * Label
   */

  .start,
  .end {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    pointer-events: none;
  }

  .label {
    display: inline-block;
  }

  .is-icon-button .label {
    display: flex;
    justify-content: center;
  }

  .label::slotted(wa-icon) {
    align-self: center;
  }

  /*
   * Caret modifier
   */

  wa-icon[part='caret'] {
    display: flex;
    align-self: center;
    align-items: center;

    &::part(svg) {
      width: 0.875em;
      height: 0.875em;
    }

    .button:has(&) .end {
      display: none;
    }
  }

  /*
   * Loading modifier
   */

  .loading {
    position: relative;
    cursor: wait;

    .start,
    .label,
    .end,
    .caret {
      /* Hidden with opacity, not visibility, so the label stays in the accessibility tree */
      opacity: 0;

      /* Unlike visibility: hidden, opacity leaves the content clickable */
      pointer-events: none;
    }

    wa-spinner {
      --indicator-color: currentColor;
      --track-color: color-mix(in oklab, currentColor, transparent 90%);

      position: absolute;
      font-size: 1em;
      height: 1em;
      width: 1em;
      top: calc(50% - 0.5em);
      left: calc(50% - 0.5em);
    }
  }

  /*
   * Badges
   */

  .button ::slotted(wa-badge) {
    border-color: var(--wa-color-surface-default);
    position: absolute;
    inset-block-start: 0;
    inset-inline-end: 0;
    translate: 50% -50%;
    pointer-events: none;
  }

  :host(:dir(rtl)) ::slotted(wa-badge) {
    translate: -50% -50%;
  }

  /*
  * Button spacing
  */

  slot[name='start']::slotted(*) {
    margin-inline-end: 0.75em;
  }

  slot[name='end']::slotted(*),
  .button:not(.visually-hidden-label) [part='caret'] {
    margin-inline-start: 0.75em;
  }
`;/*! Copyright 2026 Fonticons, Inc. - https://webawesome.com/license */var Go=S`
  :where(:root),
  .wa-neutral,
  :host([variant='neutral']) {
    --wa-color-fill-loud: var(--wa-color-neutral-fill-loud);
    --wa-color-fill-normal: var(--wa-color-neutral-fill-normal);
    --wa-color-fill-quiet: var(--wa-color-neutral-fill-quiet);
    --wa-color-border-loud: var(--wa-color-neutral-border-loud);
    --wa-color-border-normal: var(--wa-color-neutral-border-normal);
    --wa-color-border-quiet: var(--wa-color-neutral-border-quiet);
    --wa-color-on-loud: var(--wa-color-neutral-on-loud);
    --wa-color-on-normal: var(--wa-color-neutral-on-normal);
    --wa-color-on-quiet: var(--wa-color-neutral-on-quiet);
  }

  .wa-brand,
  :host([variant='brand']) {
    --wa-color-fill-loud: var(--wa-color-brand-fill-loud);
    --wa-color-fill-normal: var(--wa-color-brand-fill-normal);
    --wa-color-fill-quiet: var(--wa-color-brand-fill-quiet);
    --wa-color-border-loud: var(--wa-color-brand-border-loud);
    --wa-color-border-normal: var(--wa-color-brand-border-normal);
    --wa-color-border-quiet: var(--wa-color-brand-border-quiet);
    --wa-color-on-loud: var(--wa-color-brand-on-loud);
    --wa-color-on-normal: var(--wa-color-brand-on-normal);
    --wa-color-on-quiet: var(--wa-color-brand-on-quiet);
  }

  .wa-success,
  :host([variant='success']) {
    --wa-color-fill-loud: var(--wa-color-success-fill-loud);
    --wa-color-fill-normal: var(--wa-color-success-fill-normal);
    --wa-color-fill-quiet: var(--wa-color-success-fill-quiet);
    --wa-color-border-loud: var(--wa-color-success-border-loud);
    --wa-color-border-normal: var(--wa-color-success-border-normal);
    --wa-color-border-quiet: var(--wa-color-success-border-quiet);
    --wa-color-on-loud: var(--wa-color-success-on-loud);
    --wa-color-on-normal: var(--wa-color-success-on-normal);
    --wa-color-on-quiet: var(--wa-color-success-on-quiet);
  }

  .wa-warning,
  :host([variant='warning']) {
    --wa-color-fill-loud: var(--wa-color-warning-fill-loud);
    --wa-color-fill-normal: var(--wa-color-warning-fill-normal);
    --wa-color-fill-quiet: var(--wa-color-warning-fill-quiet);
    --wa-color-border-loud: var(--wa-color-warning-border-loud);
    --wa-color-border-normal: var(--wa-color-warning-border-normal);
    --wa-color-border-quiet: var(--wa-color-warning-border-quiet);
    --wa-color-on-loud: var(--wa-color-warning-on-loud);
    --wa-color-on-normal: var(--wa-color-warning-on-normal);
    --wa-color-on-quiet: var(--wa-color-warning-on-quiet);
  }

  .wa-danger,
  :host([variant='danger']) {
    --wa-color-fill-loud: var(--wa-color-danger-fill-loud);
    --wa-color-fill-normal: var(--wa-color-danger-fill-normal);
    --wa-color-fill-quiet: var(--wa-color-danger-fill-quiet);
    --wa-color-border-loud: var(--wa-color-danger-border-loud);
    --wa-color-border-normal: var(--wa-color-danger-border-normal);
    --wa-color-border-quiet: var(--wa-color-danger-border-quiet);
    --wa-color-on-loud: var(--wa-color-danger-on-loud);
    --wa-color-on-normal: var(--wa-color-danger-on-normal);
    --wa-color-on-quiet: var(--wa-color-danger-on-quiet);
  }
`;/*! Copyright 2026 Fonticons, Inc. - https://webawesome.com/license */function T(t,e){let o={waitUntilFirstUpdate:!1,...e};return(i,n)=>{let{update:r}=i,a=Array.isArray(t)?t:[t];i.update=function(s){a.forEach((d)=>{let u=d;if(s.has(u)){let c=s.get(u),h=this[u];if(c!==h){if(!o.waitUntilFirstUpdate||this.hasUpdated)this[n](c,h)}}}),r.call(this,s)}}}var Ge=new Set,Dt=new Map,lt,Qe="ltr",Ze="en",Qo=typeof MutationObserver<"u"&&typeof document<"u"&&typeof document.documentElement<"u";if(Qo){let t=new MutationObserver(Zo);Qe=document.documentElement.dir||"ltr",Ze=document.documentElement.lang||navigator.language,t.observe(document.documentElement,{attributes:!0,attributeFilter:["dir","lang"]})}function Et(...t){t.map((e)=>{let o=e.$code.toLowerCase();if(Dt.has(o))Dt.set(o,Object.assign(Object.assign({},Dt.get(o)),e));else Dt.set(o,e);if(!lt)lt=e}),Zo()}function Zo(){if(Qo)Qe=document.documentElement.dir||"ltr",Ze=document.documentElement.lang||navigator.language;[...Ge.keys()].map((t)=>{if(typeof t.requestUpdate==="function")t.requestUpdate()})}class Je{constructor(t){this.host=t,this.host.addController(this)}hostConnected(){Ge.add(this.host)}hostDisconnected(){Ge.delete(this.host)}dir(){return`${this.host.dir||Qe}`.toLowerCase()}lang(){let t=`${this.host.lang||Ze}`.toLowerCase().replace(/_/g,"-");try{return new Intl.Locale(t),t}catch(e){return lt?lt.$code.toLowerCase():"en"}}getTranslationData(t){var e,o;let i;try{i=new Intl.Locale(t.replace(/_/g,"-"))}catch(d){return{locale:void 0,language:"",region:"",primary:void 0,secondary:void 0}}let n=i.language.toLowerCase(),r=(o=(e=i.region)===null||e===void 0?void 0:e.toLowerCase())!==null&&o!==void 0?o:"",a=Dt.get(`${n}-${r}`),s=Dt.get(n);return{locale:i,language:n,region:r,primary:a,secondary:s}}exists(t,e){var o;let{primary:i,secondary:n}=this.getTranslationData((o=e.lang)!==null&&o!==void 0?o:this.lang());if(e=Object.assign({includeFallback:!1},e),i&&i[t]||n&&n[t]||e.includeFallback&&lt&&lt[t])return!0;return!1}term(t,...e){let{primary:o,secondary:i}=this.getTranslationData(this.lang()),n;if(o&&o[t])n=o[t];else if(i&&i[t])n=i[t];else if(lt&&lt[t])n=lt[t];else return console.error(`No translation found for: ${String(t)}`),String(t);if(typeof n==="function")return n(...e);return n}date(t,e){return t=new Date(t),new Intl.DateTimeFormat(this.lang(),e).format(t)}number(t,e){return t=Number(t),isNaN(t)?"":new Intl.NumberFormat(this.lang(),e).format(t)}relativeTime(t,e,o){return new Intl.RelativeTimeFormat(this.lang(),o).format(t,e)}}/*! Copyright 2026 Fonticons, Inc. - https://webawesome.com/license */var Jo={$code:"en",$name:"English",$dir:"ltr",allTagsRemoved:"All tags removed",am:"AM",autosizeColumn:"Autosize column",captions:"Captions",carousel:"Carousel",chooseDate:"Choose date",chooseDecade:"Choose decade",chooseMonth:"Choose month",chooseTime:"Choose time",chooseYear:"Choose year",clearEntry:"Clear entry",clearFilter:"Clear filter",clearSort:"Clear sort",close:"Close",closeCalendar:"Close calendar",closeTimeInput:"Close time picker",collapseRow:"Collapse row",columnMenu:"Column options",columnMovedToPosition:(t,e,o)=>`${t} moved to position ${e} of ${o}`,columns:"Columns",compactPageXOfY:(t,e)=>`${t} of ${e}`,completed:"Completed",copied:"Copied",copy:"Copy",createOption:(t)=>`Create "${t}"`,currentlyPlaying:"currently playing",currentValue:"Current value",date:"Date",datePickerKeyboardHelp:"Use arrow keys to change values; press Alt+Down Arrow to open the calendar.",day:"Day",dayPeriod:"AM/PM",decrement:"Decrement",deselectAllRows:"Deselect all rows",disabled:"Disabled",dropFileHere:"Drop file here or click to browse",dropFilesHere:"Drop files here or click to browse",empty:"Empty",endDate:"End date",enterFullscreen:"Enter fullscreen",error:"Error",exitFullscreen:"Exit fullscreen",expandRow:"Expand row",filterByColumn:(t)=>`Filter by ${t}`,filterFrom:"From",filterMax:"Max",filterMin:"Min",filterTo:"To",firstPage:"First page",goToSlide:(t,e)=>`Go to slide ${t} of ${e}`,hideColumn:"Hide column",hidePassword:"Hide password",hour:"Hour",incompleteDate:"Enter a valid date.",increment:"Increment",jumpBackwardX:(t)=>`Jump back ${t} pages`,jumpForwardX:(t)=>`Jump forward ${t} pages`,lastPage:"Last page",loading:"Loading",locked:"Locked",minute:"Minute",month:"Month",moreOptions:"More Options",mute:"Mute",nextDecade:"Next decade",nextMonth:"Next month",nextPage:"Next page",nextSlide:"Next slide",nextVideo:"Next Video",nextYear:"Next year",noData:"No data",noOptions:"No options",noResults:"No matching results",notCompleted:"Not completed",now:"Now",numCharacters:(t)=>{if(t===1)return"1 character";return`${t} characters`},numCharactersRemaining:(t)=>{if(t===1)return"1 character remaining";return`${t} characters remaining`},numOptionsAvailable:(t)=>{if(t===0)return"No options available";if(t===1)return"1 option available";return`${t} options available`},numOptionsSelected:(t)=>{if(t===0)return"No options selected";if(t===1)return"1 option selected";return`${t} options selected`},numRowsCopied:(t)=>t===1?"1 row copied":`${t} rows copied`,numRowsSelected:(t)=>t===1?"1 row selected":`${t} rows selected`,optionPosition:(t,e,o)=>`${t}, ${e} of ${o}`,optionsLoadError:"Options could not be loaded",pageXOfY:(t,e)=>`Page ${t} of ${e}`,pagination:"Pagination",pause:"Pause",pauseAnimation:"Pause animation",pictureInPicture:"Picture in picture",pinLeft:"Pin left",pinRight:"Pin right",play:"Play",playAnimation:"Play animation",playbackSpeed:"Playback speed",playlist:"Playlist",pm:"PM",previousDecade:"Previous decade",previousMonth:"Previous month",previousPage:"Previous page",previousSlide:"Previous slide",previousVideo:"Previous video",previousYear:"Previous year",progress:"Progress",rangeTooLong:(t)=>{if(t===1)return"Select a range no longer than 1 day";return`Select a range no longer than ${t} days`},rangeTooShort:(t)=>{if(t===1)return"Select a range at least 1 day long";return`Select a range at least ${t} days long`},readonly:"Read-only",remove:"Remove",resetColumns:"Reset columns",resize:"Resize",resizeColumn:"Resize column",rowsPerPage:"Rows per page",scrollableRegion:"Scrollable region",scrollToEnd:"Scroll to end",scrollToStart:"Scroll to start",search:"Search",second:"Second",seek:"Seek",seekProgress:(t,e)=>`${t} of ${e}`,selectAColorFromTheScreen:"Select a color from the screen",selectAllRows:"Select all rows",selected:"Selected",selectedDateLabel:(t)=>`Selected: ${t}`,selectedRangeLabel:(t)=>`Selected range: ${t}`,selectGroup:"Select group",selectionCleared:"Selection cleared",selectRow:"Select row",showingNofMRows:(t,e)=>`Showing ${t} of ${e} rows`,showingXtoYofZ:(t,e,o)=>`${t}–${e} of ${o}`,showPassword:"Show password",slideNum:(t)=>`Slide ${t}`,sortAscending:"Sort ascending",sortColumn:"Sort column",sortDescending:"Sort descending",startDate:"Start date",steps:"Steps",stepXOfY:(t,e)=>`Step ${t} of ${e}`,tagAdded:(t)=>`${t} added`,tagAlreadyAdded:(t)=>`${t} is already added`,tagInputKeyboardHelp:"Press Backspace or Delete to remove this tag.",tagRemoved:(t)=>`${t} removed`,time:"Time",timeInputKeyboardHelp:"Use arrow keys to change values; press Alt+Down Arrow to open the time picker.",today:"Today",toggleColorFormat:"Toggle color format",tooFewTags:(t)=>t===1?"Add at least 1 tag":`Add at least ${t} tags`,tooManyTags:(t)=>t===1?"Add no more than 1 tag":`Add no more than ${t} tags`,unmute:"Unmute",unpin:"Unpin",unpinColumn:"Unpin column",videoPlayer:"Video player",volume:"Volume",year:"Year",zoomIn:"Zoom in",zoomOut:"Zoom out"};Et(Jo);var ti=Jo;/*! Copyright 2026 Fonticons, Inc. - https://webawesome.com/license */var tt=class extends Je{lang(){if(this.host.didSSR&&!this.host.hasUpdated)return this.host.lang||"en";return super.lang()}};Et(ti);var ei={ATTRIBUTE:1,CHILD:2,PROPERTY:3,BOOLEAN_ATTRIBUTE:4,EVENT:5,ELEMENT:6},oi=(t)=>(...e)=>({_$litDirective$:t,values:e});class to{constructor(t){}get _$AU(){return this._$AM._$AU}_$AT(t,e,o){this._$Ct=t,this._$AM=e,this._$Ci=o}_$AS(t,e){return this.update(t,e)}update(t,e){return this.render(...e)}}var $t=oi(class extends to{constructor(t){if(super(t),t.type!==ei.ATTRIBUTE||t.name!=="class"||t.strings?.length>2)throw Error("`classMap()` can only be used in the `class` attribute and must be the only part in the attribute.")}render(t){return" "+Object.keys(t).filter((e)=>t[e]).join(" ")+" "}update(t,[e]){if(this.st===void 0){this.st=new Set,t.strings!==void 0&&(this.nt=new Set(t.strings.join(" ").split(/\s/).filter((i)=>i!=="")));for(let i in e)e[i]&&!this.nt?.has(i)&&this.st.add(i);return this.render(e)}let o=t.element.classList;for(let i of this.st)i in e||(o.remove(i),this.st.delete(i));for(let i in e){let n=!!e[i];n===this.st.has(i)||this.nt?.has(i)||(n?(o.add(i),this.st.add(i)):(o.remove(i),this.st.delete(i)))}return st}});var M=(t)=>t??P;var ni=Symbol.for(""),zn=(t)=>{if(t?.r===ni)return t?._$litStatic$};var eo=(t,...e)=>({_$litStatic$:e.reduce((o,i,n)=>o+((r)=>{if(r._$litStatic$!==void 0)return r._$litStatic$;throw Error(`Value passed to 'literal' function must be a 'literal' result: ${r}. Use 'unsafeStatic' to pass non-literal values, but
            take care to ensure page security.`)})(i)+t[n+1],t[0]),r:ni}),ii=new Map,oo=(t)=>(e,...o)=>{let i=o.length,n,r,a=[],s=[],d,u=0,c=!1;for(;u<i;){for(d=e[u];u<i&&(r=o[u],n=zn(r))!==void 0;)d+=n+e[++u],c=!0;u!==i&&s.push(r),a.push(d),u++}if(u===i&&a.push(e[i]),c){let h=a.join("$$lit$$");(e=ii.get(h))===void 0&&(a.raw=a,ii.set(h,e=a)),o=s}return t(e,...o)},ge=oo(A),Ga=oo(No),Qa=oo(qo);/*! Copyright 2026 Fonticons, Inc. - https://webawesome.com/license */var b=class extends J{constructor(){super(...arguments);this.assumeInteractionOn=["click"],this.hasSlotController=new ht(this,"[default]","start","end"),this.localize=new tt(this),this.invalid=!1,this.isIconButton=!1,this.title="",this.variant="neutral",this.appearance="accent",this.size="m",this.withCaret=!1,this.withStart=!1,this.withEnd=!1,this.disabled=!1,this.loading=!1,this.pill=!1,this.type="button"}static get validators(){return[...super.validators,yo()]}handleSizeChange(){It(this.localName,this.size)}constructLightDOMButton(){let t=document.createElement("button");for(let e of this.attributes){if(e.name==="style")continue;t.setAttribute(e.name,e.value)}if(t.type=this.type,t.style.position="absolute !important",t.style.width="0 !important",t.style.height="0 !important",t.style.clipPath="inset(50%) !important",t.style.overflow="hidden !important",t.style.whiteSpace="nowrap !important",this.name)t.name=this.name;return t.value=this.value||"",t}handleClick(t){if(this.disabled||this.loading){t.preventDefault(),t.stopImmediatePropagation();return}if(this.type!=="submit"&&this.type!=="reset")return;if(!this.getForm())return;let o=this.constructLightDOMButton();this.parentElement?.append(o),o.click(),o.remove()}handleInvalid(){this.dispatchEvent(new se)}handleLabelSlotChange(){let t=this.labelSlot.assignedNodes({flatten:!0}),e=!1,o=!1,i=!1,n=!1;if([...t].forEach((r)=>{if(r.nodeType===Node.ELEMENT_NODE){let a=r;if(a.localName==="wa-icon"){if(o=!0,!e)e=a.label!==void 0}else n=!0}else if(r.nodeType===Node.TEXT_NODE){if((r.textContent?.trim()||"").length>0)i=!0}}),this.isIconButton=o&&!i&&!n,this.customStates.set("icon-button",this.isIconButton),this.isIconButton&&!e)console.warn('Icon buttons must have a label for screen readers. Add <wa-icon label="..."> to remove this warning.',this)}isButton(){return this.href?!1:!0}isLink(){return this.href?!0:!1}handleDisabledChange(){this.customStates.set("disabled",this.disabled),this.updateValidity()}handleHrefChange(){this.customStates.set("link",this.isLink())}handleLoadingChange(){this.customStates.set("loading",this.loading)}setValue(...t){}click(){this.button.click()}focus(t){this.button.focus(t)}blur(){this.button.blur()}render(){let t=this.isLink(),e=t?eo`a`:eo`button`;return ge`
      <${e}
        part="base button"
        class=${$t({button:!0,caret:this.withCaret,disabled:this.disabled,loading:this.loading,rtl:this.localize.dir()==="rtl","has-label":this.hasSlotController.test("[default]"),"has-start":this.hasSlotController.test("start","withStart"),"has-end":this.hasSlotController.test("end","withEnd"),"is-icon-button":this.isIconButton})}
        ?disabled=${M(t?void 0:this.disabled)}
        type=${M(t?void 0:this.type)}
        title=${this.title}
        name=${M(t?void 0:this.name)}
        value=${M(t?void 0:this.value)}
        href=${M(t?this.href:void 0)}
        target=${M(t?this.target:void 0)}
        download=${M(t?this.download:void 0)}
        rel=${M(t&&this.rel?this.rel:void 0)}
        role=${M(t?void 0:"button")}
        aria-disabled=${M(t&&this.disabled?"true":void 0)}
        aria-busy=${this.loading?"true":"false"}
        tabindex=${this.disabled?"-1":"0"}
        @invalid=${this.isButton()?this.handleInvalid:null}
        @click=${this.handleClick}
      >
        <slot name="start" part="start" class="start"></slot>
        <slot part="label" class="label" @slotchange=${this.handleLabelSlotChange}></slot>
        <slot name="end" part="end" class="end"></slot>
        ${this.withCaret?ge`
                <wa-icon part="caret" class="caret" library="system" name="chevron-down" variant="solid"></wa-icon>
              `:""}
        ${this.loading?ge`<wa-spinner part="spinner"></wa-spinner>`:""}
      </${e}>
    `}};b.shadowRootOptions={...J.shadowRootOptions,delegatesFocus:!0};b.css=[Ko,Go,fe];l([D(".button")],b.prototype,"button",2);l([D("slot:not([name])")],b.prototype,"labelSlot",2);l([St()],b.prototype,"invalid",2);l([St()],b.prototype,"isIconButton",2);l([m()],b.prototype,"title",2);l([m({reflect:!0})],b.prototype,"variant",2);l([m({reflect:!0})],b.prototype,"appearance",2);l([m({reflect:!0})],b.prototype,"size",2);l([T("size")],b.prototype,"handleSizeChange",1);l([m({attribute:"with-caret",type:Boolean,reflect:!0})],b.prototype,"withCaret",2);l([m({attribute:"with-start",type:Boolean})],b.prototype,"withStart",2);l([m({attribute:"with-end",type:Boolean})],b.prototype,"withEnd",2);l([m({type:Boolean})],b.prototype,"disabled",2);l([m({type:Boolean,reflect:!0})],b.prototype,"loading",2);l([m({type:Boolean,reflect:!0})],b.prototype,"pill",2);l([m()],b.prototype,"type",2);l([m({reflect:!0})],b.prototype,"name",2);l([m({reflect:!0})],b.prototype,"value",2);l([m({reflect:!0})],b.prototype,"href",2);l([m()],b.prototype,"target",2);l([m()],b.prototype,"rel",2);l([m()],b.prototype,"download",2);l([m({attribute:"formaction"})],b.prototype,"formAction",2);l([m({attribute:"formenctype"})],b.prototype,"formEnctype",2);l([m({attribute:"formmethod"})],b.prototype,"formMethod",2);l([m({attribute:"formnovalidate",type:Boolean})],b.prototype,"formNoValidate",2);l([m({attribute:"formtarget"})],b.prototype,"formTarget",2);l([T("disabled",{waitUntilFirstUpdate:!0})],b.prototype,"handleDisabledChange",1);l([T("href")],b.prototype,"handleHrefChange",1);l([T("loading",{waitUntilFirstUpdate:!0})],b.prototype,"handleLoadingChange",1);b=l([F("wa-button")],b);b.disableWarning?.("change-in-update");/*! Copyright 2026 Fonticons, Inc. - https://webawesome.com/license */var ri=S`
  :host {
    --track-width: 2px;
    --track-color: var(--wa-color-neutral-fill-normal);
    --indicator-color: var(--wa-color-brand-fill-loud);
    --speed: 2s;
    --size: 1em;

    /*
      Resizing a spinner element using anything but font-size will break the animation because the animation uses em
      units. Therefore, if a spinner is used in a flex container without \`flex: none\` applied, the spinner can
      grow/shrink and break the animation. The use of \`flex: none\` on the host element prevents this by always having
      the spinner sized according to its actual dimensions.
    */
    flex: none;
    display: inline-flex;
    width: var(--size);
    height: var(--size);
  }

  svg {
    width: 100%;
    height: 100%;
    aspect-ratio: 1;
    animation: spin var(--speed) linear infinite;
  }

  .track,
  .indicator {
    --radius: calc(var(--size) / 2 - var(--track-width) / 2);
    --circumference: calc(var(--radius) * 2 * 3.141592654);

    cx: calc(var(--size) / 2);
    cy: calc(var(--size) / 2);
    r: var(--radius);
    fill: none;
    stroke-width: var(--track-width);
  }

  .track {
    stroke: var(--track-color);
  }

  .indicator {
    stroke: var(--indicator-color);
    stroke-linecap: round;
    stroke-dasharray: calc(0.597 * var(--circumference)), calc(0.796 * var(--circumference));
    stroke-dashoffset: calc(-0.04 * var(--circumference));
    animation: dash 1.5s ease-in-out infinite;
  }

  @keyframes spin {
    0% {
      transform: rotate(0deg);
    }
    100% {
      transform: rotate(360deg);
    }
  }

  @keyframes dash {
    0% {
      stroke-dasharray: calc(0.008 * var(--circumference)), calc(1.194 * var(--circumference));
      stroke-dashoffset: 0;
    }
    50% {
      stroke-dasharray: calc(0.716 * var(--circumference)), calc(1.194 * var(--circumference));
      stroke-dashoffset: calc(-0.278 * var(--circumference));
    }
    100% {
      stroke-dasharray: calc(0.716 * var(--circumference)), calc(1.194 * var(--circumference));
      stroke-dashoffset: calc(-0.987 * var(--circumference));
    }
  }
`;/*! Copyright 2026 Fonticons, Inc. - https://webawesome.com/license */var io=class extends _{constructor(){super(...arguments);this.localize=new tt(this)}render(){return A`
      <svg
        part="base spinner"
        role="progressbar"
        aria-label=${this.localize.term("loading")}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <circle class="track" />
        <circle class="indicator" />
      </svg>
    `}};io.css=ri;io=l([F("wa-spinner")],io);/*! Copyright 2026 Fonticons, Inc. - https://webawesome.com/license */var ai=class extends Event{constructor(){super("wa-error",{bubbles:!0,cancelable:!1,composed:!0})}};/*! Copyright 2026 Fonticons, Inc. - https://webawesome.com/license */var si=class extends Event{constructor(){super("wa-load",{bubbles:!0,cancelable:!1,composed:!0})}};/*! Copyright 2026 Fonticons, Inc. - https://webawesome.com/license */var li=S`
  :host {
    --primary-color: currentColor;
    --primary-opacity: 1;
    --secondary-color: currentColor;
    --secondary-opacity: 0.4;
    --rotate-angle: 0deg;

    box-sizing: content-box;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    vertical-align: -0.125em;
  }

  /* #region Canvas — the box the icon is centered within (mirrors Font Awesome's icon canvas). Orthogonal to font-size. */

  /* Fixed width (default): 1.25em × 1em (20 × 16px) */
  :host(:not([canvas])),
  :host([canvas='fixed']) {
    width: 1.25em;
    height: 1em;
    min-width: 1.25em; /* <-- this is what Safari respects for intrinsic */
    min-height: 1em;
  }

  /* Auto: hug the icon's width. \`auto-width\` is the deprecated alias for canvas="auto". */
  :host([canvas='auto']),
  :host([auto-width]:not([canvas])) {
    width: auto;
    height: 1em;
  }

  /* Square: 1.25em × 1.25em (20 × 20px) */
  :host([canvas='square']) {
    width: 1.25em;
    height: 1.25em;
    min-width: 1.25em;
    min-height: 1.25em;
  }

  /* Roomy: 1.5em × 1.5em (24 × 24px) */
  :host([canvas='roomy']) {
    width: 1.5em;
    height: 1.5em;
    min-width: 1.5em;
    min-height: 1.5em;
  }

  /* #endregion */

  svg {
    /* NOTE: Avoid setting fill here. A stylesheet rule beats SVG presentation attributes, breaking stroke-based
       libraries like Lucide (fill="none" stroke="currentColor") and attribute-based mutators (issue #1733). The default
       library applies fill="currentColor" in its mutator instead. */
    height: 1em;
    overflow: visible;
    width: auto;

    /* Duotone colors with path-specific opacity fallback */
    path[data-duotone-primary] {
      color: var(--primary-color);
      opacity: var(--path-opacity, var(--primary-opacity));
    }

    path[data-duotone-secondary] {
      color: var(--secondary-color);
      opacity: var(--path-opacity, var(--secondary-opacity));
    }
  }

  /* Rotation */
  :host([rotate]) {
    transform: rotate(var(--rotate-angle, 0deg));
  }

  /* Flipping */
  :host([flip='x']) {
    transform: scaleX(-1);
  }
  :host([flip='y']) {
    transform: scaleY(-1);
  }
  :host([flip='both']) {
    transform: scale(-1, -1);
  }

  /* Rotation and Flipping combined */
  :host([rotate][flip='x']) {
    transform: rotate(var(--rotate-angle, 0deg)) scaleX(-1);
  }
  :host([rotate][flip='y']) {
    transform: rotate(var(--rotate-angle, 0deg)) scaleY(-1);
  }
  :host([rotate][flip='both']) {
    transform: rotate(var(--rotate-angle, 0deg)) scale(-1, -1);
  }

  /* #region Animations — ported from Font Awesome 7.3 (--fa-* props mapped to wa-icon's --* names) */

  :host([animation='beat']) {
    animation-name: beat;
    animation-delay: var(--animation-delay, 0s);
    animation-direction: var(--animation-direction, normal);
    animation-duration: var(--animation-duration, 1s);
    animation-iteration-count: var(--animation-iteration-count, infinite);
    animation-timing-function: var(--animation-timing, ease-in-out);
  }

  :host([animation='bounce']) {
    animation-name: bounce;
    animation-delay: var(--animation-delay, 0s);
    animation-direction: var(--animation-direction, normal);
    animation-duration: var(--animation-duration, 1s);
    animation-iteration-count: var(--animation-iteration-count, infinite);
    animation-timing-function: var(--animation-timing, cubic-bezier(0.28, 0.84, 0.42, 1));
  }

  :host([animation='fade']) {
    animation-name: fade;
    animation-delay: var(--animation-delay, 0s);
    animation-direction: var(--animation-direction, normal);
    animation-duration: var(--animation-duration, 1s);
    animation-iteration-count: var(--animation-iteration-count, infinite);
    animation-timing-function: var(--animation-timing, ease-in-out);
  }

  :host([animation='beat-fade']) {
    animation-name: beat-fade;
    animation-delay: var(--animation-delay, 0s);
    animation-direction: var(--animation-direction, normal);
    animation-duration: var(--animation-duration, 1s);
    animation-iteration-count: var(--animation-iteration-count, infinite);
    animation-timing-function: var(--animation-timing, ease-in-out);
  }

  :host([animation='flip']) {
    animation-name: flip;
    animation-delay: var(--animation-delay, 0s);
    animation-direction: var(--animation-direction, normal);
    animation-duration: var(--animation-duration, 1.5s);
    animation-iteration-count: var(--animation-iteration-count, infinite);
    animation-timing-function: var(--animation-timing, ease-in-out);
  }

  :host([animation='flip-360']) {
    animation-name: flip-360;
    animation-delay: var(--animation-delay, 0s);
    animation-direction: var(--animation-direction, normal);
    animation-duration: var(--animation-duration, 1s);
    animation-iteration-count: var(--animation-iteration-count, infinite);
    animation-timing-function: var(--animation-timing, ease-in-out);
  }

  :host([animation='shake']) {
    animation-name: shake;
    animation-delay: var(--animation-delay, 0s);
    animation-direction: var(--animation-direction, normal);
    animation-duration: var(--animation-duration, 0.75s);
    animation-iteration-count: var(--animation-iteration-count, infinite);
    animation-timing-function: var(--animation-timing, ease-in-out);
  }

  :host([animation='spin']) {
    animation-name: spin;
    animation-delay: var(--animation-delay, 0s);
    animation-direction: var(--animation-direction, normal);
    animation-duration: var(--animation-duration, 2s);
    animation-iteration-count: var(--animation-iteration-count, infinite);
    animation-timing-function: var(--animation-timing, linear);
  }

  :host([animation='spin-pulse']) {
    animation-name: spin;
    animation-delay: var(--animation-delay, 0s);
    animation-direction: var(--animation-direction, normal);
    animation-duration: var(--animation-duration, 1s);
    animation-iteration-count: var(--animation-iteration-count, infinite);
    animation-timing-function: var(--animation-timing, steps(8));
  }

  /* spin-reverse is FA's reverse modifier expressed as a standalone value; reverse any spin via --animation-direction: reverse */
  :host([animation='spin-reverse']) {
    animation-name: spin;
    animation-delay: var(--animation-delay, 0s);
    animation-direction: var(--animation-direction, reverse);
    animation-duration: var(--animation-duration, 2s);
    animation-iteration-count: var(--animation-iteration-count, infinite);
    animation-timing-function: var(--animation-timing, linear);
  }

  :host([animation='spin-snap']) {
    animation-name: spin-snap;
    animation-delay: var(--animation-delay, 0s);
    animation-direction: var(--animation-direction, normal);
    animation-duration: var(--animation-duration, 3s);
    animation-iteration-count: var(--animation-iteration-count, infinite);
    animation-timing-function: var(--animation-timing, linear);
  }

  :host([animation='spin-snap-4']) {
    animation-name: spin-snap-4;
    animation-delay: var(--animation-delay, 0s);
    animation-direction: var(--animation-direction, normal);
    animation-duration: var(--animation-duration, 2.4s);
    animation-iteration-count: var(--animation-iteration-count, infinite);
    animation-timing-function: var(--animation-timing, linear);
  }

  :host([animation='spin-snap-8']) {
    animation-name: spin-snap-8;
    animation-delay: var(--animation-delay, 0s);
    animation-direction: var(--animation-direction, normal);
    animation-duration: var(--animation-duration, 4s);
    animation-iteration-count: var(--animation-iteration-count, infinite);
    animation-timing-function: var(--animation-timing, linear);
  }

  :host([animation='buzz']) {
    animation-name: buzz;
    animation-delay: var(--animation-delay, 0s);
    animation-direction: var(--animation-direction, normal);
    animation-duration: var(--animation-duration, 0.6s);
    animation-iteration-count: var(--animation-iteration-count, infinite);
    animation-timing-function: var(--animation-timing, linear);
  }

  :host([animation='wag']) {
    animation-name: wag;
    animation-delay: var(--animation-delay, 0s);
    animation-direction: var(--animation-direction, normal);
    animation-duration: var(--animation-duration, 0.9s);
    animation-iteration-count: var(--animation-iteration-count, infinite);
    animation-timing-function: var(--animation-timing, ease-out);
    transform-origin: bottom center;
  }

  :host([animation='float']) {
    animation-name: float;
    animation-delay: var(--animation-delay, 0s);
    animation-direction: var(--animation-direction, normal);
    animation-duration: var(--animation-duration, 3s);
    animation-iteration-count: var(--animation-iteration-count, infinite);
    animation-timing-function: var(--animation-timing, ease-in-out);
    will-change: transform;
  }

  :host([animation='swing']) {
    animation-name: swing;
    animation-delay: var(--animation-delay, 0s);
    animation-direction: var(--animation-direction, normal);
    animation-duration: var(--animation-duration, 1.2s);
    animation-iteration-count: var(--animation-iteration-count, infinite);
    animation-timing-function: var(--animation-timing, ease-out);
    transform-origin: top center;
  }

  :host([animation='jello']) {
    animation-name: jello;
    animation-delay: var(--animation-delay, 0s);
    animation-direction: var(--animation-direction, normal);
    animation-duration: var(--animation-duration, 0.9s);
    animation-iteration-count: var(--animation-iteration-count, infinite);
    animation-timing-function: var(--animation-timing, ease-out);
  }

  @media (prefers-reduced-motion: reduce) {
    :host([animation='beat']),
    :host([animation='bounce']),
    :host([animation='fade']),
    :host([animation='beat-fade']),
    :host([animation='flip']),
    :host([animation='flip-360']),
    :host([animation='shake']),
    :host([animation='spin']),
    :host([animation='spin-pulse']),
    :host([animation='spin-reverse']),
    :host([animation='spin-snap']),
    :host([animation='spin-snap-4']),
    :host([animation='spin-snap-8']),
    :host([animation='buzz']),
    :host([animation='wag']),
    :host([animation='float']),
    :host([animation='swing']),
    :host([animation='jello']) {
      animation: none !important;
      transition: none !important;
    }
  }

  /* #endregion */

  /* #region Keyframes — ported verbatim from Font Awesome 7.3 */

  @keyframes beat {
    0% {
      transform: scale(1);
    }
    25% {
      transform: scale(calc(1.25 * var(--beat-scale, 1.25)));
    }
    45% {
      transform: scale(calc(1.22 * var(--beat-scale, 1.22)));
    }
    65% {
      transform: scale(calc(1.25 * var(--beat-scale, 1.25)));
    }
    90% {
      transform: scale(1);
    }
  }

  @keyframes bounce {
    0% {
      transform: scale(1, 1) translateY(0);
      /* No fallback by design (ported from FA 7.3): the first segment uses the user's --animation-timing or the CSS
         initial ease, while the explicit cubic-beziers on later stops drive the bounce physics. */
      animation-timing-function: var(--animation-timing);
    }
    14% {
      transform: scale(var(--bounce-start-scale-x, 1.06), var(--bounce-start-scale-y, 0.94))
        translateY(var(--bounce-anticipation, 3px));
      animation-timing-function: cubic-bezier(0.33, 0, 0.66, 0.33);
    }
    32% {
      transform: scale(var(--bounce-jump-scale-x, 0.94), var(--bounce-jump-scale-y, 1.12))
        translateY(calc(-1 * var(--bounce-height, 0.5em)));
      animation-timing-function: cubic-bezier(0.33, 0.66, 0.66, 1);
    }
    52% {
      transform: scale(1, 1) translateY(calc(-1 * var(--bounce-height, 0.5em) * 1.1));
      animation-timing-function: cubic-bezier(0.5, 0, 1, 0.5);
    }
    70% {
      transform: scale(var(--bounce-land-scale-x, 1.06), var(--bounce-land-scale-y, 0.92)) translateY(0);
      animation-timing-function: cubic-bezier(0.33, 0.33, 0.66, 1);
    }
    85% {
      transform: scale(0.98, 1.04) translateY(calc(-2px * var(--bounce-rebound, 1)));
      animation-timing-function: cubic-bezier(0.33, 0, 0.66, 1);
    }
    100% {
      transform: scale(1, 1) translateY(0);
    }
  }

  @keyframes fade {
    0% {
      opacity: 1;
      transform: scale(1);
      animation-timing-function: cubic-bezier(0.2, 0, 0.4, 1);
    }
    40% {
      opacity: var(--fade-opacity, 0.4);
      transform: scale(0.98);
      animation-timing-function: cubic-bezier(0.4, 0, 0.6, 1);
    }
    100% {
      opacity: 1;
      transform: scale(1);
    }
  }

  @keyframes beat-fade {
    0% {
      opacity: var(--beat-fade-opacity, 0.4);
      transform: scale(1);
      animation-timing-function: cubic-bezier(0.2, 0, 0.4, 1);
    }
    25% {
      opacity: calc(var(--beat-fade-opacity, 0.4) + 0.4);
      transform: scale(var(--beat-fade-scale, 1.28));
      animation-timing-function: cubic-bezier(0.4, 0, 0.6, 1);
    }
    45% {
      opacity: 1;
      transform: scale(var(--beat-fade-scale, 1.25));
      animation-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
    }
    65% {
      opacity: calc(var(--beat-fade-opacity, 0.4) + 0.4);
      transform: scale(var(--beat-fade-scale, 1.28));
      animation-timing-function: cubic-bezier(0.4, 0, 0.6, 1);
    }
    100% {
      opacity: var(--beat-fade-opacity, 0.4);
      transform: scale(1);
    }
  }

  @keyframes flip {
    0% {
      transform: perspective(2em) scale(1) rotate3d(var(--flip-x, 0), var(--flip-y, 1), var(--flip-z, 0), 0deg);
      animation-timing-function: cubic-bezier(0.2, 0, 0.4, 1);
    }
    8% {
      transform: perspective(2em) scale(var(--flip-anticipation-scale, 0.95))
        rotate3d(var(--flip-x, 0), var(--flip-y, 1), var(--flip-z, 0), 0deg);
      animation-timing-function: cubic-bezier(0.33, 0, 0.66, 0.33);
    }
    35% {
      transform: perspective(2em) scale(1)
        rotate3d(var(--flip-x, 0), var(--flip-y, 1), var(--flip-z, 0), calc(var(--flip-angle, -360deg) * 0.6));
      animation-timing-function: linear;
    }
    65% {
      transform: perspective(2em) scale(1)
        rotate3d(var(--flip-x, 0), var(--flip-y, 1), var(--flip-z, 0), calc(var(--flip-angle, -360deg) * 0.5));
      animation-timing-function: cubic-bezier(0.33, 0.66, 0.66, 1);
    }
    92% {
      transform: perspective(2em) scale(1)
        rotate3d(
          var(--flip-x, 0),
          var(--flip-y, 1),
          var(--flip-z, 0),
          calc(var(--flip-angle, -360deg) * var(--flip-overshoot, 1.04))
        );
      animation-timing-function: cubic-bezier(0.33, 0, 0.66, 1);
    }
    100% {
      transform: perspective(2em) scale(1)
        rotate3d(var(--flip-x, 0), var(--flip-y, 1), var(--flip-z, 0), var(--flip-angle, -360deg));
    }
  }

  @keyframes flip-360 {
    0% {
      transform: perspective(2em) scale(1) rotate3d(var(--flip-x, 0), var(--flip-y, 1), var(--flip-z, 0), 0deg);
      animation-timing-function: cubic-bezier(0.2, 0, 0.4, 1);
    }
    8% {
      transform: perspective(2em) scale(var(--flip-anticipation-scale, 0.95))
        rotate3d(var(--flip-x, 0), var(--flip-y, 1), var(--flip-z, 0), 0deg);
      animation-timing-function: cubic-bezier(0.33, 0, 0.66, 0.33);
    }
    50% {
      transform: perspective(2em) scale(1)
        rotate3d(var(--flip-x, 0), var(--flip-y, 1), var(--flip-z, 0), calc(var(--flip-angle, -360deg) * 0.6));
      animation-timing-function: cubic-bezier(0.33, 0.66, 0.66, 1);
    }
    80% {
      transform: perspective(2em) scale(1)
        rotate3d(
          var(--flip-x, 0),
          var(--flip-y, 1),
          var(--flip-z, 0),
          calc(var(--flip-angle, -360deg) * var(--flip-overshoot, 1.04))
        );
      animation-timing-function: cubic-bezier(0.33, 0, 0.66, 1);
    }
    100% {
      transform: perspective(2em) scale(1)
        rotate3d(var(--flip-x, 0), var(--flip-y, 1), var(--flip-z, 0), var(--flip-angle, -360deg));
    }
  }

  @keyframes shake {
    0% {
      transform: rotate(0deg);
      animation-timing-function: cubic-bezier(0.2, 0, 0.8, 1);
    }
    8% {
      transform: rotate(35deg) translateX(1px);
      animation-timing-function: cubic-bezier(0.3, 0, 0.7, 1);
    }
    20% {
      transform: rotate(-22deg) translateX(-1px);
      animation-timing-function: cubic-bezier(0.3, 0, 0.7, 1);
    }
    35% {
      transform: rotate(15deg) translateX(1px);
      animation-timing-function: cubic-bezier(0.3, 0, 0.7, 1);
    }
    50% {
      transform: rotate(-9deg);
      animation-timing-function: cubic-bezier(0.4, 0, 0.6, 1);
    }
    65% {
      transform: rotate(5deg);
      animation-timing-function: cubic-bezier(0.4, 0, 0.6, 1);
    }
    78% {
      transform: rotate(-3deg);
      animation-timing-function: cubic-bezier(0.4, 0, 0.6, 1);
    }
    90% {
      transform: rotate(1deg);
      animation-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
    }
    100% {
      transform: rotate(0deg);
    }
  }

  @keyframes spin {
    0% {
      transform: rotate(0deg);
    }
    100% {
      transform: rotate(360deg);
    }
  }

  @keyframes spin-snap {
    0% {
      transform: rotate(0deg);
      animation-timing-function: cubic-bezier(0, 0, 0.2, 1);
    }
    12% {
      transform: rotate(60deg);
      animation-timing-function: cubic-bezier(0.8, 0, 1, 1);
    }
    16.67% {
      transform: rotate(60deg);
      animation-timing-function: cubic-bezier(0, 0, 0.2, 1);
    }
    28.67% {
      transform: rotate(120deg);
      animation-timing-function: cubic-bezier(0.8, 0, 1, 1);
    }
    33.33% {
      transform: rotate(120deg);
      animation-timing-function: cubic-bezier(0, 0, 0.2, 1);
    }
    45.33% {
      transform: rotate(180deg);
      animation-timing-function: cubic-bezier(0.8, 0, 1, 1);
    }
    50% {
      transform: rotate(180deg);
      animation-timing-function: cubic-bezier(0, 0, 0.2, 1);
    }
    62% {
      transform: rotate(240deg);
      animation-timing-function: cubic-bezier(0.8, 0, 1, 1);
    }
    66.67% {
      transform: rotate(240deg);
      animation-timing-function: cubic-bezier(0, 0, 0.2, 1);
    }
    78.67% {
      transform: rotate(300deg);
      animation-timing-function: cubic-bezier(0.8, 0, 1, 1);
    }
    83.33% {
      transform: rotate(300deg);
      animation-timing-function: cubic-bezier(0, 0, 0.2, 1);
    }
    95.33% {
      transform: rotate(360deg);
      animation-timing-function: cubic-bezier(0.8, 0, 1, 1);
    }
    100% {
      transform: rotate(360deg);
    }
  }

  @keyframes spin-snap-4 {
    0% {
      transform: rotate(0deg);
      animation-timing-function: cubic-bezier(0, 0, 0.2, 1);
    }
    15% {
      transform: rotate(90deg);
      animation-timing-function: cubic-bezier(0.8, 0, 1, 1);
    }
    25% {
      transform: rotate(90deg);
      animation-timing-function: cubic-bezier(0, 0, 0.2, 1);
    }
    40% {
      transform: rotate(180deg);
      animation-timing-function: cubic-bezier(0.8, 0, 1, 1);
    }
    50% {
      transform: rotate(180deg);
      animation-timing-function: cubic-bezier(0, 0, 0.2, 1);
    }
    65% {
      transform: rotate(270deg);
      animation-timing-function: cubic-bezier(0.8, 0, 1, 1);
    }
    75% {
      transform: rotate(270deg);
      animation-timing-function: cubic-bezier(0, 0, 0.2, 1);
    }
    90% {
      transform: rotate(360deg);
      animation-timing-function: cubic-bezier(0.8, 0, 1, 1);
    }
    100% {
      transform: rotate(360deg);
    }
  }

  @keyframes spin-snap-8 {
    0% {
      transform: rotate(0deg);
      animation-timing-function: cubic-bezier(0, 0, 0.2, 1);
    }
    9% {
      transform: rotate(45deg);
      animation-timing-function: cubic-bezier(0.8, 0, 1, 1);
    }
    12.5% {
      transform: rotate(45deg);
      animation-timing-function: cubic-bezier(0, 0, 0.2, 1);
    }
    21.5% {
      transform: rotate(90deg);
      animation-timing-function: cubic-bezier(0.8, 0, 1, 1);
    }
    25% {
      transform: rotate(90deg);
      animation-timing-function: cubic-bezier(0, 0, 0.2, 1);
    }
    34% {
      transform: rotate(135deg);
      animation-timing-function: cubic-bezier(0.8, 0, 1, 1);
    }
    37.5% {
      transform: rotate(135deg);
      animation-timing-function: cubic-bezier(0, 0, 0.2, 1);
    }
    46.5% {
      transform: rotate(180deg);
      animation-timing-function: cubic-bezier(0.8, 0, 1, 1);
    }
    50% {
      transform: rotate(180deg);
      animation-timing-function: cubic-bezier(0, 0, 0.2, 1);
    }
    59% {
      transform: rotate(225deg);
      animation-timing-function: cubic-bezier(0.8, 0, 1, 1);
    }
    62.5% {
      transform: rotate(225deg);
      animation-timing-function: cubic-bezier(0, 0, 0.2, 1);
    }
    71.5% {
      transform: rotate(270deg);
      animation-timing-function: cubic-bezier(0.8, 0, 1, 1);
    }
    75% {
      transform: rotate(270deg);
      animation-timing-function: cubic-bezier(0, 0, 0.2, 1);
    }
    84% {
      transform: rotate(315deg);
      animation-timing-function: cubic-bezier(0.8, 0, 1, 1);
    }
    87.5% {
      transform: rotate(315deg);
      animation-timing-function: cubic-bezier(0, 0, 0.2, 1);
    }
    96.5% {
      transform: rotate(360deg);
      animation-timing-function: cubic-bezier(0.8, 0, 1, 1);
    }
    100% {
      transform: rotate(360deg);
    }
  }

  @keyframes buzz {
    0% {
      transform: translateX(0) rotate(0deg);
      animation-timing-function: cubic-bezier(0.1, 0, 0.9, 1);
    }
    5% {
      transform: translateX(var(--buzz-distance, 4px)) rotate(0.5deg);
    }
    10% {
      transform: translateX(calc(-1 * var(--buzz-distance, 4px))) rotate(-0.5deg);
    }
    15% {
      transform: translateX(var(--buzz-distance, 4px)) rotate(0.3deg);
    }
    20% {
      transform: translateX(calc(-1 * var(--buzz-distance, 4px))) rotate(-0.3deg);
    }
    25% {
      transform: translateX(calc(var(--buzz-distance, 4px) * 0.7)) rotate(0.2deg);
    }
    30% {
      transform: translateX(calc(-1 * var(--buzz-distance, 4px) * 0.7)) rotate(-0.2deg);
    }
    35% {
      transform: translateX(calc(var(--buzz-distance, 4px) * 0.4)) rotate(0.1deg);
    }
    40% {
      transform: translateX(0) rotate(0deg);
    }
    100% {
      transform: translateX(0) rotate(0deg);
    }
  }

  @keyframes wag {
    0% {
      transform: rotate(0deg);
      animation-timing-function: cubic-bezier(0.2, 0, 0.6, 1);
    }
    12% {
      transform: rotate(var(--wag-angle, 12deg));
      animation-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
    }
    24% {
      transform: rotate(2deg);
      animation-timing-function: cubic-bezier(0.2, 0, 0.6, 1);
    }
    36% {
      transform: rotate(calc(var(--wag-angle, 12deg) * 0.85));
      animation-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
    }
    48% {
      transform: rotate(1deg);
      animation-timing-function: cubic-bezier(0.2, 0, 0.6, 1);
    }
    58% {
      transform: rotate(calc(var(--wag-angle, 12deg) * 0.6));
      animation-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
    }
    68% {
      transform: rotate(0deg);
    }
    100% {
      transform: rotate(0deg);
    }
  }

  @keyframes float {
    0% {
      transform: translateY(0) translateX(0) rotate(0deg)
        scale(var(--float-squash-x, 1.02), var(--float-squash-y, 0.98));
      animation-timing-function: cubic-bezier(0.33, 0, 0.66, 0.33);
    }
    15% {
      transform: translateY(calc(-0.4 * var(--float-height, 6px))) translateX(var(--float-drift, 1px))
        rotate(var(--float-tilt, 1deg)) scale(1, 1);
      animation-timing-function: cubic-bezier(0.33, 0.66, 0.66, 1);
    }
    35% {
      transform: translateY(calc(-1 * var(--float-height, 6px))) translateX(0) rotate(0deg)
        scale(var(--float-stretch-x, 0.98), var(--float-stretch-y, 1.03));
      animation-timing-function: cubic-bezier(0.5, 0, 0.5, 0);
    }
    50% {
      transform: translateY(calc(-0.92 * var(--float-height, 6px))) translateX(calc(-0.5 * var(--float-drift, 1px)))
        rotate(calc(-0.5 * var(--float-tilt, 1deg))) scale(0.995, 1.01);
      animation-timing-function: cubic-bezier(0.33, 0, 0.66, 0.33);
    }
    70% {
      transform: translateY(calc(-0.3 * var(--float-height, 6px))) translateX(calc(-1 * var(--float-drift, 1px)))
        rotate(calc(-1 * var(--float-tilt, 1deg))) scale(1, 1);
      animation-timing-function: cubic-bezier(0.33, 0.66, 0.66, 1);
    }
    90% {
      transform: translateY(calc(0.05 * var(--float-height, 6px))) translateX(0) rotate(0deg)
        scale(var(--float-squash-x, 1.02), var(--float-squash-y, 0.98));
      animation-timing-function: cubic-bezier(0.33, 0, 0.66, 1);
    }
    100% {
      transform: translateY(0) translateX(0) rotate(0deg)
        scale(var(--float-squash-x, 1.02), var(--float-squash-y, 0.98));
    }
  }

  @keyframes swing {
    0% {
      transform: rotate(0deg);
      animation-timing-function: cubic-bezier(0.2, 0, 0.8, 1);
    }
    8% {
      transform: rotate(var(--swing-angle, 22deg));
      animation-timing-function: cubic-bezier(0.3, 0, 0.7, 1);
    }
    18% {
      transform: rotate(calc(-1 * var(--swing-angle, 22deg) * 0.85));
      animation-timing-function: cubic-bezier(0.3, 0, 0.7, 1);
    }
    28% {
      transform: rotate(calc(var(--swing-angle, 22deg) * 0.65));
      animation-timing-function: cubic-bezier(0.35, 0, 0.65, 1);
    }
    38% {
      transform: rotate(calc(-1 * var(--swing-angle, 22deg) * 0.45));
      animation-timing-function: cubic-bezier(0.4, 0, 0.6, 1);
    }
    48% {
      transform: rotate(calc(var(--swing-angle, 22deg) * 0.25));
      animation-timing-function: cubic-bezier(0.4, 0, 0.6, 1);
    }
    56% {
      transform: rotate(calc(-1 * var(--swing-angle, 22deg) * 0.1));
      animation-timing-function: cubic-bezier(0.4, 0, 0.6, 1);
    }
    64% {
      transform: rotate(0deg);
    }
    100% {
      transform: rotate(0deg);
    }
  }

  @keyframes jello {
    0% {
      transform: scale(1, 1);
      animation-timing-function: cubic-bezier(0.2, 0, 0.8, 1);
    }
    12% {
      transform: scale(var(--jello-scale-x, 1.15), calc(2 - var(--jello-scale-x, 1.15)));
      animation-timing-function: cubic-bezier(0.3, 0, 0.7, 1);
    }
    24% {
      transform: scale(calc(2 - var(--jello-scale-y, 1.12)), var(--jello-scale-y, 1.12));
      animation-timing-function: cubic-bezier(0.3, 0, 0.7, 1);
    }
    36% {
      transform: scale(
        calc(1 + (var(--jello-scale-x, 1.15) - 1) * 0.5),
        calc(2 - (1 + (var(--jello-scale-x, 1.15) - 1) * 0.5))
      );
      animation-timing-function: cubic-bezier(0.4, 0, 0.6, 1);
    }
    48% {
      transform: scale(
        calc(2 - (1 + (var(--jello-scale-y, 1.12) - 1) * 0.3)),
        calc(1 + (var(--jello-scale-y, 1.12) - 1) * 0.3)
      );
      animation-timing-function: cubic-bezier(0.4, 0, 0.6, 1);
    }
    58% {
      transform: scale(1.02, 0.98);
      animation-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
    }
    68% {
      transform: scale(1, 1);
    }
    100% {
      transform: scale(1, 1);
    }
  }

  /* #endregion */
`;/*! Copyright 2026 Fonticons, Inc. - https://webawesome.com/license */var kn="",no="";function ci(){return kn.replace(/\/$/,"")}function _n(t){no=t}function di(){if(!no){let t=document.querySelector("[data-fa-kit-code]");if(t)_n(t.getAttribute("data-fa-kit-code")||"")}return no}/*! Copyright 2026 Fonticons, Inc. - https://webawesome.com/license */var ui="7.3.0";function Pn(t,e,o){let i="solid";if(e==="chisel")i="chisel-regular";if(e==="etch")i="etch-solid";if(e==="graphite")i="graphite-thin";if(e==="jelly"){if(i="jelly-regular",o==="duo-regular")i="jelly-duo-regular";if(o==="fill-regular")i="jelly-fill-regular"}if(e==="jelly-duo")i="jelly-duo-regular";if(e==="jelly-fill")i="jelly-fill-regular";if(e==="notdog"){if(o==="solid")i="notdog-solid";if(o==="duo-solid")i="notdog-duo-solid"}if(e==="notdog-duo")i="notdog-duo-solid";if(e==="slab"){if(o==="solid"||o==="regular")i="slab-regular";if(o==="press-regular")i="slab-press-regular"}if(e==="slab-press")i="slab-press-regular";if(e==="slab-duo")i="slab-duo-regular";if(e==="slab-press-duo")i="slab-press-duo-regular";if(e==="thumbprint")i="thumbprint-light";if(e==="utility")i="utility-semibold";if(e==="utility-duo")i="utility-duo-semibold";if(e==="utility-fill")i="utility-fill-semibold";if(e==="whiteboard")i="whiteboard-semibold";if(e==="mosaic")i="mosaic-solid";if(e==="pixel")i="pixel-regular";if(e==="vellum")i="vellum-solid";if(e==="classic"){if(o==="thin")i="thin";if(o==="light")i="light";if(o==="regular")i="regular";if(o==="solid")i="solid"}if(e==="duotone"){if(o==="thin")i="duotone-thin";if(o==="light")i="duotone-light";if(o==="regular")i="duotone-regular";if(o==="solid")i="duotone"}if(e==="sharp"){if(o==="thin")i="sharp-thin";if(o==="light")i="sharp-light";if(o==="regular")i="sharp-regular";if(o==="solid")i="sharp-solid"}if(e==="sharp-duotone"){if(o==="thin")i="sharp-duotone-thin";if(o==="light")i="sharp-duotone-light";if(o==="regular")i="sharp-duotone-regular";if(o==="solid")i="sharp-duotone-solid"}if(e==="brands")i="brands";return i}function Fn(t,e,o){let i=Pn(t,e,o),n=ci();if(n)return`${n}/${i}/${t}.svg`;let r=di();return r.length>0?`https://ka-p.fontawesome.com/releases/v${ui}/svgs/${i}/${t}.svg?token=${encodeURIComponent(r)}`:`https://ka-f.fontawesome.com/releases/v${ui}/svgs/${i}/${t}.svg`}var Mn={name:"default",resolver:(t,e="classic",o="solid")=>Fn(t,e,o),mutator:(t,e)=>{if(!t.hasAttribute("fill"))t.setAttribute("fill","currentColor");if(e?.family&&!t.hasAttribute("data-duotone-initialized")){let{family:o,variant:i}=e;if(o==="duotone"||o==="sharp-duotone"||o==="notdog-duo"||o==="notdog"&&i==="duo-solid"||o==="jelly-duo"||o==="jelly"&&i==="duo-regular"||o==="utility-duo"||o==="slab-duo"||o==="slab-press-duo"||o==="thumbprint"){let n=[...t.querySelectorAll("path")],r=n.find((s)=>!s.hasAttribute("opacity")),a=n.find((s)=>s.hasAttribute("opacity"));if(!r||!a)return;if(r.setAttribute("data-duotone-primary",""),a.setAttribute("data-duotone-secondary",""),e.swapOpacity&&r&&a){let s=a.getAttribute("opacity")||"0.4";r.style.setProperty("--path-opacity",s),a.style.setProperty("--path-opacity","1")}t.setAttribute("data-duotone-initialized","")}}}},mi=Mn;/*! Copyright 2026 Fonticons, Inc. - https://webawesome.com/license */function Rn(t){return`data:image/svg+xml,${encodeURIComponent(t)}`}var ro={solid:{"arrow-down":'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 384 512"><!--!Font Awesome Free v7.2.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2026 Fonticons, Inc.--><path d="M169.4 502.6c12.5 12.5 32.8 12.5 45.3 0l160-160c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0L224 402.7 224 32c0-17.7-14.3-32-32-32s-32 14.3-32 32l0 370.7-105.4-105.4c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3l160 160z"/></svg>',"arrow-up":'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 384 512"><!--!Font Awesome Free v7.2.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2026 Fonticons, Inc.--><path d="M214.6 9.4c-12.5-12.5-32.8-12.5-45.3 0l-160 160c-12.5 12.5-12.5 32.8 0 45.3s32.8 12.5 45.3 0L160 109.3 160 480c0 17.7 14.3 32 32 32s32-14.3 32-32l0-370.7 105.4 105.4c12.5 12.5 32.8 12.5 45.3 0s12.5-32.8 0-45.3l-160-160z"/></svg>',backward:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640"><!--!Font Awesome Free v7.2.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2026 Fonticons, Inc.--><path d="M236.3 107.1C247.9 96 265 92.9 279.7 99.2C294.4 105.5 304 120 304 136L304 272.3L476.3 107.2C487.9 96 505 92.9 519.7 99.2C534.4 105.5 544 120 544 136L544 504C544 520 534.4 534.5 519.7 540.8C505 547.1 487.9 544 476.3 532.9L304 367.7L304 504C304 520 294.4 534.5 279.7 540.8C265 547.1 247.9 544 236.3 532.9L44.3 348.9C36.5 341.3 32 330.9 32 320C32 309.1 36.5 298.7 44.3 291.1L236.3 107.1z"/></svg>',"backward-step":'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640"><!--!Font Awesome Free v7.2.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2026 Fonticons, Inc.--><path d="M491 100.8C478.1 93.8 462.3 94.5 450 102.6L192 272.1L192 128C192 110.3 177.7 96 160 96C142.3 96 128 110.3 128 128L128 512C128 529.7 142.3 544 160 544C177.7 544 192 529.7 192 512L192 367.9L450 537.5C462.3 545.6 478 546.3 491 539.3C504 532.3 512 518.8 512 504.1L512 136.1C512 121.4 503.9 107.9 491 100.9z"/></svg>',bars:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512"><!--! Font Awesome Free 7.3.1 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free (Icons: CC BY 4.0, Fonts: SIL OFL 1.1, Code: MIT License) Copyright 2026 Fonticons, Inc. --><path d="M0 96C0 78.3 14.3 64 32 64l384 0c17.7 0 32 14.3 32 32s-14.3 32-32 32L32 128C14.3 128 0 113.7 0 96zM0 256c0-17.7 14.3-32 32-32l384 0c17.7 0 32 14.3 32 32s-14.3 32-32 32L32 288c-17.7 0-32-14.3-32-32zM448 416c0 17.7-14.3 32-32 32L32 448c-17.7 0-32-14.3-32-32s14.3-32 32-32l384 0c17.7 0 32 14.3 32 32z"/></svg>',"angles-left":'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><!--! Font Awesome Free 7.0.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2025 Fonticons, Inc. --><path d="M77.3 256 214.7 118.6c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0l-160 160c-12.5 12.5-12.5 32.8 0 45.3l160 160c12.5 12.5 32.8 12.5 45.3 0s12.5-32.8 0-45.3L77.3 256zm192 0L406.7 118.6c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0l-160 160c-12.5 12.5-12.5 32.8 0 45.3l160 160c12.5 12.5 32.8 12.5 45.3 0s12.5-32.8 0-45.3L269.3 256z"/></svg>',"angles-right":'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><!--! Font Awesome Free 7.0.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2025 Fonticons, Inc. --><path d="M434.7 256 297.3 118.6c-12.5-12.5-12.5-32.8 0-45.3s32.8-12.5 45.3 0l160 160c12.5 12.5 12.5 32.8 0 45.3l-160 160c-12.5 12.5-32.8 12.5-45.3 0s-12.5-32.8 0-45.3L434.7 256zm-192 0L105.3 118.6c-12.5-12.5-12.5-32.8 0-45.3s32.8-12.5 45.3 0l160 160c12.5 12.5 12.5 32.8 0 45.3l-160 160c-12.5 12.5-32.8 12.5-45.3 0s-12.5-32.8 0-45.3L242.7 256z"/></svg>',check:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512"><!--! Font Awesome Free 7.0.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2025 Fonticons, Inc. --><path d="M434.8 70.1c14.3 10.4 17.5 30.4 7.1 44.7l-256 352c-5.5 7.6-14 12.3-23.4 13.1s-18.5-2.7-25.1-9.3l-128-128c-12.5-12.5-12.5-32.8 0-45.3s32.8-12.5 45.3 0l101.5 101.5 234-321.7c10.4-14.3 30.4-17.5 44.7-7.1z"/></svg>',"chevron-down":'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512"><!--! Font Awesome Free 7.0.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2025 Fonticons, Inc. --><path d="M201.4 406.6c12.5 12.5 32.8 12.5 45.3 0l192-192c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0L224 338.7 54.6 169.4c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3l192 192z"/></svg>',"chevron-left":'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 512"><!--! Font Awesome Free 7.0.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2025 Fonticons, Inc. --><path d="M9.4 233.4c-12.5 12.5-12.5 32.8 0 45.3l192 192c12.5 12.5 32.8 12.5 45.3 0s12.5-32.8 0-45.3L77.3 256 246.6 86.6c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0l-192 192z"/></svg>',"chevron-right":'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 512"><!--! Font Awesome Free 7.0.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2025 Fonticons, Inc. --><path d="M311.1 233.4c12.5 12.5 12.5 32.8 0 45.3l-192 192c-12.5 12.5-32.8 12.5-45.3 0s-12.5-32.8 0-45.3L243.2 256 73.9 86.6c-12.5-12.5-12.5-32.8 0-45.3s32.8-12.5 45.3 0l192 192z"/></svg>',circle:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><!--! Font Awesome Free 7.0.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2025 Fonticons, Inc. --><path d="M0 256a256 256 0 1 1 512 0 256 256 0 1 1 -512 0z"/></svg>',"closed-captioning":'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640"><!--!Font Awesome Free v7.2.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2026 Fonticons, Inc.--><path d="M64 192C64 156.7 92.7 128 128 128L512 128C547.3 128 576 156.7 576 192L576 448C576 483.3 547.3 512 512 512L128 512C92.7 512 64 483.3 64 448L64 192zM216 272L248 272C252.4 272 256 275.6 256 280C256 293.3 266.7 304 280 304C293.3 304 304 293.3 304 280C304 249.1 278.9 224 248 224L216 224C185.1 224 160 249.1 160 280L160 360C160 390.9 185.1 416 216 416L248 416C278.9 416 304 390.9 304 360C304 346.7 293.3 336 280 336C266.7 336 256 346.7 256 360C256 364.4 252.4 368 248 368L216 368C211.6 368 208 364.4 208 360L208 280C208 275.6 211.6 272 216 272zM384 280C384 275.6 387.6 272 392 272L424 272C428.4 272 432 275.6 432 280C432 293.3 442.7 304 456 304C469.3 304 480 293.3 480 280C480 249.1 454.9 224 424 224L392 224C361.1 224 336 249.1 336 280L336 360C336 390.9 361.1 416 392 416L424 416C454.9 416 480 390.9 480 360C480 346.7 469.3 336 456 336C442.7 336 432 346.7 432 360C432 364.4 428.4 368 424 368L392 368C387.6 368 384 364.4 384 360L384 280z"/></svg>',"closed-captioning-slash":'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640"><!--!Font Awesome Free v7.2.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2026 Fonticons, Inc.--><path d="M39 39.1C48.4 29.7 63.6 29.7 72.9 39.1L161.8 128L512 128C547.3 128 576 156.7 576 192L576 448C576 473.5 561.1 495.4 539.6 505.8L601 567.1C610.4 576.5 610.4 591.7 601 601C591.6 610.3 576.4 610.4 567.1 601L39 73.1C29.7 63.7 29.7 48.5 39 39.1zM384 350.1L384 279.9C384 275.5 387.6 271.9 392 271.9L424 271.9C428.4 271.9 432 275.5 432 279.9C432 293.2 442.7 303.9 456 303.9C469.3 303.9 480 293.2 480 279.9C480 249 454.9 223.9 424 223.9L392 223.9C361.1 223.9 336 249 336 279.9L336 302.1L384 350.1zM445.5 411.6C465.7 403.2 480 383.2 480 359.9C480 346.6 469.3 335.9 456 335.9C442.7 335.9 432 346.6 432 359.9C432 364.3 428.4 367.9 424 367.9L401.8 367.9L445.5 411.6zM162.3 264.1C160.8 269.1 160 274.5 160 280L160 360C160 390.9 185.1 416 216 416L248 416C266.1 416 282.1 407.5 292.4 394.2L410.2 512L128 512C92.7 512 64 483.3 64 448L64 192C64 184.2 65.4 176.7 68 169.8L162.3 264.1zM256.1 357.9C256 358.6 256 359.3 256 360C256 364.4 252.4 368 248 368L216 368C211.6 368 208 364.4 208 360L208 309.8L256.1 357.9z"/></svg>',compress:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512"><!--!Font Awesome Free v7.2.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2026 Fonticons, Inc.--><path d="M160 64c0-17.7-14.3-32-32-32S96 46.3 96 64l0 64-64 0c-17.7 0-32 14.3-32 32s14.3 32 32 32l96 0c17.7 0 32-14.3 32-32l0-96zM32 320c-17.7 0-32 14.3-32 32s14.3 32 32 32l64 0 0 64c0 17.7 14.3 32 32 32s32-14.3 32-32l0-96c0-17.7-14.3-32-32-32l-96 0zM352 64c0-17.7-14.3-32-32-32s-32 14.3-32 32l0 96c0 17.7 14.3 32 32 32l96 0c17.7 0 32-14.3 32-32s-14.3-32-32-32l-64 0 0-64zM320 320c-17.7 0-32 14.3-32 32l0 96c0 17.7 14.3 32 32 32s32-14.3 32-32l0-64 64 0c17.7 0 32-14.3 32-32s-14.3-32-32-32l-96 0z"/></svg>',ellipsis:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640"><!--!Font Awesome Free v7.3.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2026 Fonticons, Inc.--><path d="M96 320C96 289.1 121.1 264 152 264C182.9 264 208 289.1 208 320C208 350.9 182.9 376 152 376C121.1 376 96 350.9 96 320zM264 320C264 289.1 289.1 264 320 264C350.9 264 376 289.1 376 320C376 350.9 350.9 376 320 376C289.1 376 264 350.9 264 320zM488 264C518.9 264 544 289.1 544 320C544 350.9 518.9 376 488 376C457.1 376 432 350.9 432 320C432 289.1 457.1 264 488 264z"/></svg>',"ellipsis-vertical":'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640"><!--!Font Awesome Free v7.2.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2026 Fonticons, Inc.--><path d="M320 208C289.1 208 264 182.9 264 152C264 121.1 289.1 96 320 96C350.9 96 376 121.1 376 152C376 182.9 350.9 208 320 208zM320 432C350.9 432 376 457.1 376 488C376 518.9 350.9 544 320 544C289.1 544 264 518.9 264 488C264 457.1 289.1 432 320 432zM376 320C376 350.9 350.9 376 320 376C289.1 376 264 350.9 264 320C264 289.1 289.1 264 320 264C350.9 264 376 289.1 376 320z"/></svg>',expand:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640"><!--!Font Awesome Free v7.2.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2026 Fonticons, Inc.--><path d="M128 96C110.3 96 96 110.3 96 128L96 224C96 241.7 110.3 256 128 256C145.7 256 160 241.7 160 224L160 160L224 160C241.7 160 256 145.7 256 128C256 110.3 241.7 96 224 96L128 96zM160 416C160 398.3 145.7 384 128 384C110.3 384 96 398.3 96 416L96 512C96 529.7 110.3 544 128 544L224 544C241.7 544 256 529.7 256 512C256 494.3 241.7 480 224 480L160 480L160 416zM416 96C398.3 96 384 110.3 384 128C384 145.7 398.3 160 416 160L480 160L480 224C480 241.7 494.3 256 512 256C529.7 256 544 241.7 544 224L544 128C544 110.3 529.7 96 512 96L416 96zM544 416C544 398.3 529.7 384 512 384C494.3 384 480 398.3 480 416L480 480L416 480C398.3 480 384 494.3 384 512C384 529.7 398.3 544 416 544L512 544C529.7 544 544 529.7 544 512L544 416z"/></svg>',eyedropper:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><!--! Font Awesome Free 7.0.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2025 Fonticons, Inc. --><path d="M341.6 29.2l-101.6 101.6-9.4-9.4c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3l160 160c12.5 12.5 32.8 12.5 45.3 0s12.5-32.8 0-45.3l-9.4-9.4 101.6-101.6c39-39 39-102.2 0-141.1s-102.2-39-141.1 0zM55.4 323.3c-15 15-23.4 35.4-23.4 56.6l0 42.4-26.6 39.9c-8.5 12.7-6.8 29.6 4 40.4s27.7 12.5 40.4 4l39.9-26.6 42.4 0c21.2 0 41.6-8.4 56.6-23.4l109.4-109.4-45.3-45.3-109.4 109.4c-3 3-7.1 4.7-11.3 4.7l-36.1 0 0-36.1c0-4.2 1.7-8.3 4.7-11.3l109.4-109.4-45.3-45.3-109.4 109.4z"/></svg>',filter:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><!--!Font Awesome Free v7.2.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2026 Fonticons, Inc.--><path d="M32 64C19.1 64 7.4 71.8 2.4 83.8S.2 109.5 9.4 118.6L192 301.3 192 416c0 8.5 3.4 16.6 9.4 22.6l64 64c9.2 9.2 22.9 11.9 34.9 6.9S320 492.9 320 480l0-178.7 182.6-182.6c9.2-9.2 11.9-22.9 6.9-34.9S492.9 64 480 64L32 64z"/></svg>',forward:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640"><!--!Font Awesome Free v7.2.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2026 Fonticons, Inc.--><path d="M403.7 107.1C392.1 96 375 92.9 360.3 99.2C345.6 105.5 336 120 336 136L336 272.3L163.7 107.2C152.1 96 135 92.9 120.3 99.2C105.6 105.5 96 120 96 136L96 504C96 520 105.6 534.5 120.3 540.8C135 547.1 152.1 544 163.7 532.9L336 367.7L336 504C336 520 345.6 534.5 360.3 540.8C375 547.1 392.1 544 403.7 532.9L595.7 348.9C603.6 341.4 608 330.9 608 320C608 309.1 603.5 298.7 595.7 291.1L403.7 107.1z"/></svg>',file:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640"><!--!Font Awesome Free 7.1.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2026 Fonticons, Inc.--><path d="M192 64C156.7 64 128 92.7 128 128L128 512C128 547.3 156.7 576 192 576L448 576C483.3 576 512 547.3 512 512L512 234.5C512 217.5 505.3 201.2 493.3 189.2L386.7 82.7C374.7 70.7 358.5 64 341.5 64L192 64zM453.5 240L360 240C346.7 240 336 229.3 336 216L336 122.5L453.5 240z"/></svg>',"file-audio":'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640"><!--!Font Awesome Free 7.1.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2026 Fonticons, Inc.--><path d="M128 128C128 92.7 156.7 64 192 64L341.5 64C358.5 64 374.8 70.7 386.8 82.7L493.3 189.3C505.3 201.3 512 217.6 512 234.6L512 512C512 547.3 483.3 576 448 576L192 576C156.7 576 128 547.3 128 512L128 128zM336 122.5L336 216C336 229.3 346.7 240 360 240L453.5 240L336 122.5zM389.8 307.7C380.7 301.4 368.3 303.6 362 312.7C355.7 321.8 357.9 334.2 367 340.5C390.9 357.2 406.4 384.8 406.4 416C406.4 447.2 390.8 474.9 367 491.5C357.9 497.8 355.7 510.3 362 519.3C368.3 528.3 380.8 530.6 389.8 524.3C423.9 500.5 446.4 460.8 446.4 416C446.4 371.2 424 331.5 389.8 307.7zM208 376C199.2 376 192 383.2 192 392L192 440C192 448.8 199.2 456 208 456L232 456L259.2 490C262.2 493.8 266.8 496 271.7 496L272 496C280.8 496 288 488.8 288 480L288 352C288 343.2 280.8 336 272 336L271.7 336C266.8 336 262.2 338.2 259.2 342L232 376L208 376zM336 448.2C336 458.9 346.5 466.4 354.9 459.8C367.8 449.5 376 433.7 376 416C376 398.3 367.8 382.5 354.9 372.2C346.5 365.5 336 373.1 336 383.8L336 448.3z"/></svg>',"file-code":'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640"><!--!Font Awesome Free 7.1.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2026 Fonticons, Inc.--><path d="M128 128C128 92.7 156.7 64 192 64L341.5 64C358.5 64 374.8 70.7 386.8 82.7L493.3 189.3C505.3 201.3 512 217.6 512 234.6L512 512C512 547.3 483.3 576 448 576L192 576C156.7 576 128 547.3 128 512L128 128zM336 122.5L336 216C336 229.3 346.7 240 360 240L453.5 240L336 122.5zM282.2 359.6C290.8 349.5 289.7 334.4 279.6 325.8C269.5 317.2 254.4 318.3 245.8 328.4L197.8 384.4C190.1 393.4 190.1 406.6 197.8 415.6L245.8 471.6C254.4 481.7 269.6 482.8 279.6 474.2C289.6 465.6 290.8 450.4 282.2 440.4L247.6 400L282.2 359.6zM394.2 328.4C385.6 318.3 370.4 317.2 360.4 325.8C350.4 334.4 349.2 349.6 357.8 359.6L392.4 400L357.8 440.4C349.2 450.5 350.3 465.6 360.4 474.2C370.5 482.8 385.6 481.7 394.2 471.6L442.2 415.6C449.9 406.6 449.9 393.4 442.2 384.4L394.2 328.4z"/></svg>',"file-excel":'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640"><!--!Font Awesome Free 7.1.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2026 Fonticons, Inc.--><path d="M128 128C128 92.7 156.7 64 192 64L341.5 64C358.5 64 374.8 70.7 386.8 82.7L493.3 189.3C505.3 201.3 512 217.6 512 234.6L512 512C512 547.3 483.3 576 448 576L192 576C156.7 576 128 547.3 128 512L128 128zM336 122.5L336 216C336 229.3 346.7 240 360 240L453.5 240L336 122.5zM292 330.7C284.6 319.7 269.7 316.7 258.7 324C247.7 331.3 244.7 346.3 252 357.3L291.2 416L252 474.7C244.6 485.7 247.6 500.6 258.7 508C269.8 515.4 284.6 512.4 292 501.3L320 459.3L348 501.3C355.4 512.3 370.3 515.3 381.3 508C392.3 500.7 395.3 485.7 388 474.7L348.8 416L388 357.3C395.4 346.3 392.4 331.4 381.3 324C370.2 316.6 355.4 319.6 348 330.7L320 372.7L292 330.7z"/></svg>',"file-image":'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640"><!--!Font Awesome Free 7.1.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2026 Fonticons, Inc.--><path d="M128 128C128 92.7 156.7 64 192 64L341.5 64C358.5 64 374.8 70.7 386.8 82.7L493.3 189.3C505.3 201.3 512 217.6 512 234.6L512 512C512 547.3 483.3 576 448 576L192 576C156.7 576 128 547.3 128 512L128 128zM336 122.5L336 216C336 229.3 346.7 240 360 240L453.5 240L336 122.5zM256 320C256 302.3 241.7 288 224 288C206.3 288 192 302.3 192 320C192 337.7 206.3 352 224 352C241.7 352 256 337.7 256 320zM220.6 512L419.4 512C435.2 512 448 499.2 448 483.4C448 476.1 445.2 469 440.1 463.7L343.3 361.9C337.3 355.6 328.9 352 320.1 352L319.8 352C311 352 302.7 355.6 296.6 361.9L199.9 463.7C194.8 469 192 476.1 192 483.4C192 499.2 204.8 512 220.6 512z"/></svg>',"file-pdf":'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640"><!--!Font Awesome Free 7.1.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2026 Fonticons, Inc.--><path d="M128 64C92.7 64 64 92.7 64 128L64 512C64 547.3 92.7 576 128 576L208 576L208 464C208 428.7 236.7 400 272 400L448 400L448 234.5C448 217.5 441.3 201.2 429.3 189.2L322.7 82.7C310.7 70.7 294.5 64 277.5 64L128 64zM389.5 240L296 240C282.7 240 272 229.3 272 216L272 122.5L389.5 240zM272 444C261 444 252 453 252 464L252 592C252 603 261 612 272 612C283 612 292 603 292 592L292 564L304 564C337.1 564 364 537.1 364 504C364 470.9 337.1 444 304 444L272 444zM304 524L292 524L292 484L304 484C315 484 324 493 324 504C324 515 315 524 304 524zM400 444C389 444 380 453 380 464L380 592C380 603 389 612 400 612L432 612C460.7 612 484 588.7 484 560L484 496C484 467.3 460.7 444 432 444L400 444zM420 572L420 484L432 484C438.6 484 444 489.4 444 496L444 560C444 566.6 438.6 572 432 572L420 572zM508 464L508 592C508 603 517 612 528 612C539 612 548 603 548 592L548 548L576 548C587 548 596 539 596 528C596 517 587 508 576 508L548 508L548 484L576 484C587 484 596 475 596 464C596 453 587 444 576 444L528 444C517 444 508 453 508 464z"/></svg>',"file-powerpoint":'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640"><!--!Font Awesome Free 7.1.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2026 Fonticons, Inc.--><path d="M128 128C128 92.7 156.7 64 192 64L341.5 64C358.5 64 374.8 70.7 386.8 82.7L493.3 189.3C505.3 201.3 512 217.6 512 234.6L512 512C512 547.3 483.3 576 448 576L192 576C156.7 576 128 547.3 128 512L128 128zM336 122.5L336 216C336 229.3 346.7 240 360 240L453.5 240L336 122.5zM280 320C266.7 320 256 330.7 256 344L256 488C256 501.3 266.7 512 280 512C293.3 512 304 501.3 304 488L304 464L328 464C367.8 464 400 431.8 400 392C400 352.2 367.8 320 328 320L280 320zM328 416L304 416L304 368L328 368C341.3 368 352 378.7 352 392C352 405.3 341.3 416 328 416z"/></svg>',"file-video":'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640"><!--!Font Awesome Free 7.1.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2026 Fonticons, Inc.--><path d="M128 128C128 92.7 156.7 64 192 64L341.5 64C358.5 64 374.8 70.7 386.8 82.7L493.3 189.3C505.3 201.3 512 217.6 512 234.6L512 512C512 547.3 483.3 576 448 576L192 576C156.7 576 128 547.3 128 512L128 128zM336 122.5L336 216C336 229.3 346.7 240 360 240L453.5 240L336 122.5zM208 368L208 464C208 481.7 222.3 496 240 496L336 496C353.7 496 368 481.7 368 464L368 440L403 475C406.2 478.2 410.5 480 415 480C424.4 480 432 472.4 432 463L432 368.9C432 359.5 424.4 351.9 415 351.9C410.5 351.9 406.2 353.7 403 356.9L368 391.9L368 367.9C368 350.2 353.7 335.9 336 335.9L240 335.9C222.3 335.9 208 350.2 208 367.9z"/></svg>',"file-word":'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640"><!--!Font Awesome Free 7.1.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2026 Fonticons, Inc.--><path d="M128 128C128 92.7 156.7 64 192 64L341.5 64C358.5 64 374.8 70.7 386.8 82.7L493.3 189.3C505.3 201.3 512 217.6 512 234.6L512 512C512 547.3 483.3 576 448 576L192 576C156.7 576 128 547.3 128 512L128 128zM336 122.5L336 216C336 229.3 346.7 240 360 240L453.5 240L336 122.5zM263.4 338.8C260.5 325.9 247.7 317.7 234.8 320.6C221.9 323.5 213.7 336.3 216.6 349.2L248.6 493.2C250.9 503.7 260 511.4 270.8 512C281.6 512.6 291.4 505.9 294.8 495.6L320 419.9L345.2 495.6C348.6 505.8 358.4 512.5 369.2 512C380 511.5 389.1 503.8 391.4 493.2L423.4 349.2C426.3 336.3 418.1 323.4 405.2 320.6C392.3 317.8 379.4 325.9 376.6 338.8L363.4 398.2L342.8 336.4C339.5 326.6 330.4 320 320 320C309.6 320 300.5 326.6 297.2 336.4L276.6 398.2L263.4 338.8z"/></svg>',"file-zipper":'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640"><!--!Font Awesome Free 7.1.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2026 Fonticons, Inc.--><path d="M128 128C128 92.7 156.7 64 192 64L341.5 64C358.5 64 374.8 70.7 386.8 82.7L493.3 189.3C505.3 201.3 512 217.6 512 234.6L512 512C512 547.3 483.3 576 448 576L192 576C156.7 576 128 547.3 128 512L128 128zM336 122.5L336 216C336 229.3 346.7 240 360 240L453.5 240L336 122.5zM192 136C192 149.3 202.7 160 216 160L264 160C277.3 160 288 149.3 288 136C288 122.7 277.3 112 264 112L216 112C202.7 112 192 122.7 192 136zM192 232C192 245.3 202.7 256 216 256L264 256C277.3 256 288 245.3 288 232C288 218.7 277.3 208 264 208L216 208C202.7 208 192 218.7 192 232zM256 304L224 304C206.3 304 192 318.3 192 336L192 384C192 410.5 213.5 432 240 432C266.5 432 288 410.5 288 384L288 336C288 318.3 273.7 304 256 304zM240 368C248.8 368 256 375.2 256 384C256 392.8 248.8 400 240 400C231.2 400 224 392.8 224 384C224 375.2 231.2 368 240 368z"/></svg>',"forward-step":'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 384 512"><!--!Font Awesome Free v7.2.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2026 Fonticons, Inc.--><path d="M21 36.8c12.9-7 28.7-6.3 41 1.8L320 208.1 320 64c0-17.7 14.3-32 32-32s32 14.3 32 32l0 384c0 17.7-14.3 32-32 32s-32-14.3-32-32l0-144.1-258 169.6c-12.3 8.1-28 8.8-41 1.8S0 454.7 0 440L0 72C0 57.3 8.1 43.8 21 36.8z"/></svg>',gauge:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><!--!Font Awesome Free v7.2.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2026 Fonticons, Inc.--><path d="M0 256a256 256 0 1 1 512 0 256 256 0 1 1 -512 0zm320 96c0-26.9-16.5-49.9-40-59.3L280 120c0-13.3-10.7-24-24-24s-24 10.7-24 24l0 172.7c-23.5 9.5-40 32.5-40 59.3 0 35.3 28.7 64 64 64s64-28.7 64-64zM144 176a32 32 0 1 0 0-64 32 32 0 1 0 0 64zm-16 80a32 32 0 1 0 -64 0 32 32 0 1 0 64 0zm288 32a32 32 0 1 0 0-64 32 32 0 1 0 0 64zM400 144a32 32 0 1 0 -64 0 32 32 0 1 0 64 0z"/></svg>',gear:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640"><!--!Font Awesome Free v7.2.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2026 Fonticons, Inc.--><path d="M259.1 73.5C262.1 58.7 275.2 48 290.4 48L350.2 48C365.4 48 378.5 58.7 381.5 73.5L396 143.5C410.1 149.5 423.3 157.2 435.3 166.3L503.1 143.8C517.5 139 533.3 145 540.9 158.2L570.8 210C578.4 223.2 575.7 239.8 564.3 249.9L511 297.3C511.9 304.7 512.3 312.3 512.3 320C512.3 327.7 511.8 335.3 511 342.7L564.4 390.2C575.8 400.3 578.4 417 570.9 430.1L541 481.9C533.4 495 517.6 501.1 503.2 496.3L435.4 473.8C423.3 482.9 410.1 490.5 396.1 496.6L381.7 566.5C378.6 581.4 365.5 592 350.4 592L290.6 592C275.4 592 262.3 581.3 259.3 566.5L244.9 496.6C230.8 490.6 217.7 482.9 205.6 473.8L137.5 496.3C123.1 501.1 107.3 495.1 99.7 481.9L69.8 430.1C62.2 416.9 64.9 400.3 76.3 390.2L129.7 342.7C128.8 335.3 128.4 327.7 128.4 320C128.4 312.3 128.9 304.7 129.7 297.3L76.3 249.8C64.9 239.7 62.3 223 69.8 209.9L99.7 158.1C107.3 144.9 123.1 138.9 137.5 143.7L205.3 166.2C217.4 157.1 230.6 149.5 244.6 143.4L259.1 73.5zM320.3 400C364.5 399.8 400.2 363.9 400 319.7C399.8 275.5 363.9 239.8 319.7 240C275.5 240.2 239.8 276.1 240 320.3C240.2 364.5 276.1 400.2 320.3 400z"/></svg>',"grip-vertical":'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 512"><!--! Font Awesome Free 7.0.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2025 Fonticons, Inc. --><path d="M128 40c0-22.1-17.9-40-40-40L40 0C17.9 0 0 17.9 0 40L0 88c0 22.1 17.9 40 40 40l48 0c22.1 0 40-17.9 40-40l0-48zm0 192c0-22.1-17.9-40-40-40l-48 0c-22.1 0-40 17.9-40 40l0 48c0 22.1 17.9 40 40 40l48 0c22.1 0 40-17.9 40-40l0-48zM0 424l0 48c0 22.1 17.9 40 40 40l48 0c22.1 0 40-17.9 40-40l0-48c0-22.1-17.9-40-40-40l-48 0c-22.1 0-40 17.9-40 40zM320 40c0-22.1-17.9-40-40-40L232 0c-22.1 0-40 17.9-40 40l0 48c0 22.1 17.9 40 40 40l48 0c22.1 0 40-17.9 40-40l0-48zM192 232l0 48c0 22.1 17.9 40 40 40l48 0c22.1 0 40-17.9 40-40l0-48c0-22.1-17.9-40-40-40l-48 0c-22.1 0-40 17.9-40 40zM320 424c0-22.1-17.9-40-40-40l-48 0c-22.1 0-40 17.9-40 40l0 48c0 22.1 17.9 40 40 40l48 0c22.1 0 40-17.9 40-40l0-48z"/></svg>',indeterminate:'<svg part="indeterminate-icon" class="icon" viewBox="0 0 16 16"><g stroke="none" stroke-width="1" fill="none" fill-rule="evenodd" stroke-linecap="round"><g stroke="currentColor" stroke-width="2"><g transform="translate(2.285714 6.857143)"><path d="M10.2857143,1.14285714 L1.14285714,1.14285714"/></g></g></g></svg>',"magnifying-glass":'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><!--!Font Awesome Free v7.2.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2026 Fonticons, Inc.--><path d="M416 208c0 45.9-14.9 88.3-40 122.7L502.6 457.4c12.5 12.5 12.5 32.8 0 45.3s-32.8 12.5-45.3 0L330.7 376C296.3 401.1 253.9 416 208 416 93.1 416 0 322.9 0 208S93.1 0 208 0 416 93.1 416 208zM208 352a144 144 0 1 0 0-288 144 144 0 1 0 0 288z"/></svg>',minus:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512"><!--! Font Awesome Free 7.0.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2025 Fonticons, Inc. --><path d="M0 256c0-17.7 14.3-32 32-32l384 0c17.7 0 32 14.3 32 32s-14.3 32-32 32L32 288c-17.7 0-32-14.3-32-32z"/></svg>',pause:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 384 512"><!--! Font Awesome Free 7.0.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2025 Fonticons, Inc. --><path d="M48 32C21.5 32 0 53.5 0 80L0 432c0 26.5 21.5 48 48 48l64 0c26.5 0 48-21.5 48-48l0-352c0-26.5-21.5-48-48-48L48 32zm224 0c-26.5 0-48 21.5-48 48l0 352c0 26.5 21.5 48 48 48l64 0c26.5 0 48-21.5 48-48l0-352c0-26.5-21.5-48-48-48l-64 0z"/></svg>',"picture-in-picture":'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><!--!Font Awesome Free v7.2.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2026 Fonticons, Inc.--><path d="M448 32c35.3 0 64 28.7 64 64l0 112-64 0 0-112-384 0 0 320 144 0 0 64-144 0-6.5-.3c-30.1-3.1-54.1-27-57.1-57.1L0 416 0 96C0 62.9 25.2 35.6 57.5 32.3L64 32 448 32zm16 224c26.5 0 48 21.5 48 48l0 128c0 26.5-21.5 48-48 48l-160 0c-26.5 0-48-21.5-48-48l0-128c0-26.5 21.5-48 48-48l160 0z"/></svg>',play:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512"><!--! Font Awesome Free 7.0.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2025 Fonticons, Inc. --><path d="M91.2 36.9c-12.4-6.8-27.4-6.5-39.6 .7S32 57.9 32 72l0 368c0 14.1 7.5 27.2 19.6 34.4s27.2 7.5 39.6 .7l336-184c12.8-7 20.8-20.5 20.8-35.1s-8-28.1-20.8-35.1l-336-184z"/></svg>',"play-circle":'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><!--!Font Awesome Free v7.2.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2026 Fonticons, Inc.--><path d="M0 256a256 256 0 1 1 512 0 256 256 0 1 1 -512 0zM188.3 147.1c-7.6 4.2-12.3 12.3-12.3 20.9l0 176c0 8.7 4.7 16.7 12.3 20.9s16.8 4.1 24.3-.5l144-88c7.1-4.4 11.5-12.1 11.5-20.5s-4.4-16.1-11.5-20.5l-144-88c-7.4-4.5-16.7-4.7-24.3-.5z"/></svg>',plus:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640"><!--!Font Awesome Free 7.1.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2026 Fonticons, Inc.--><path d="M352 128C352 110.3 337.7 96 320 96C302.3 96 288 110.3 288 128L288 288L128 288C110.3 288 96 302.3 96 320C96 337.7 110.3 352 128 352L288 352L288 512C288 529.7 302.3 544 320 544C337.7 544 352 529.7 352 512L352 352L512 352C529.7 352 544 337.7 544 320C544 302.3 529.7 288 512 288L352 288L352 128z"/></svg>',star:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 576 512"><!--! Font Awesome Free 7.0.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2025 Fonticons, Inc. --><path d="M309.5-18.9c-4.1-8-12.4-13.1-21.4-13.1s-17.3 5.1-21.4 13.1L193.1 125.3 33.2 150.7c-8.9 1.4-16.3 7.7-19.1 16.3s-.5 18 5.8 24.4l114.4 114.5-25.2 159.9c-1.4 8.9 2.3 17.9 9.6 23.2s16.9 6.1 25 2L288.1 417.6 432.4 491c8 4.1 17.7 3.3 25-2s11-14.2 9.6-23.2L441.7 305.9 556.1 191.4c6.4-6.4 8.6-15.8 5.8-24.4s-10.1-14.9-19.1-16.3L383 125.3 309.5-18.9z"/></svg>',"table-columns":'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512"><!--!Font Awesome Free v7.2.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2026 Fonticons, Inc.--><path d="M0 96C0 60.7 28.7 32 64 32l320 0c35.3 0 64 28.7 64 64l0 320c0 35.3-28.7 64-64 64L64 480c-35.3 0-64-28.7-64-64L0 96zm64 64l0 256 128 0 0-256-128 0zm320 0l-128 0 0 256 128 0 0-256z"/></svg>',thumbtack:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 384 512"><!--!Font Awesome Free v7.2.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2026 Fonticons, Inc.--><path d="M32 32C32 14.3 46.3 0 64 0L320 0c17.7 0 32 14.3 32 32s-14.3 32-32 32l-29.5 0 10.3 134.1c37.1 21.2 65.8 56.4 78.2 99.7l3.8 13.4c2.8 9.7 .8 20-5.2 28.1S362 352 352 352L32 352c-10 0-19.5-4.7-25.5-12.7s-8-18.4-5.2-28.1L5 297.8c12.4-43.3 41-78.5 78.2-99.7L93.5 64 64 64C46.3 64 32 49.7 32 32zM160 400l64 0 0 112c0 17.7-14.3 32-32 32s-32-14.3-32-32l0-112z"/></svg>',"up-down":'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><!--!Font Awesome Free v7.2.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2026 Fonticons, Inc.--><path d="M406.6 502.6l96-96c9.2-9.2 11.9-22.9 6.9-34.9S492.9 352 480 352l-64 0 0-320c0-17.7-14.3-32-32-32s-32 14.3-32 32l0 320-64 0c-12.9 0-24.6 7.8-29.6 19.8s-2.2 25.7 6.9 34.9l96 96c12.5 12.5 32.8 12.5 45.3 0zM150.6 9.4c-12.5-12.5-32.8-12.5-45.3 0l-96 96c-9.2 9.2-11.9 22.9-6.9 34.9S19.1 160 32 160l64 0 0 320c0 17.7 14.3 32 32 32s32-14.3 32-32l0-320 64 0c12.9 0 24.6-7.8 29.6-19.8s2.2-25.7-6.9-34.9l-96-96z"/></svg>',upload:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640"><!--!Font Awesome Free 7.1.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2026 Fonticons, Inc.--><path d="M352 173.3L352 384C352 401.7 337.7 416 320 416C302.3 416 288 401.7 288 384L288 173.3L246.6 214.7C234.1 227.2 213.8 227.2 201.3 214.7C188.8 202.2 188.8 181.9 201.3 169.4L297.3 73.4C309.8 60.9 330.1 60.9 342.6 73.4L438.6 169.4C451.1 181.9 451.1 202.2 438.6 214.7C426.1 227.2 405.8 227.2 393.3 214.7L352 173.3zM320 464C364.2 464 400 428.2 400 384L480 384C515.3 384 544 412.7 544 448L544 480C544 515.3 515.3 544 480 544L160 544C124.7 544 96 515.3 96 480L96 448C96 412.7 124.7 384 160 384L240 384C240 428.2 275.8 464 320 464zM464 488C477.3 488 488 477.3 488 464C488 450.7 477.3 440 464 440C450.7 440 440 450.7 440 464C440 477.3 450.7 488 464 488z"/></svg>',user:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512"><!--! Font Awesome Free 7.0.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2025 Fonticons, Inc. --><path d="M224 248a120 120 0 1 0 0-240 120 120 0 1 0 0 240zm-29.7 56C95.8 304 16 383.8 16 482.3 16 498.7 29.3 512 45.7 512l356.6 0c16.4 0 29.7-13.3 29.7-29.7 0-98.5-79.8-178.3-178.3-178.3l-59.4 0z"/></svg>',volume:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><!--!Font Awesome Free v7.2.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2026 Fonticons, Inc.--><path d="M48 352l48 0 134.1 119.2c6.4 5.7 14.6 8.8 23.1 8.8 19.2 0 34.8-15.6 34.8-34.8l0-378.4c0-19.2-15.6-34.8-34.8-34.8-8.5 0-16.7 3.1-23.1 8.8L96 160 48 160c-26.5 0-48 21.5-48 48l0 96c0 26.5 21.5 48 48 48zM441.1 107c-10.3-8.4-25.4-6.8-33.8 3.5s-6.8 25.4 3.5 33.8C443.3 170.7 464 210.9 464 256s-20.7 85.3-53.2 111.8c-10.3 8.4-11.8 23.5-3.5 33.8s23.5 11.8 33.8 3.5c43.2-35.2 70.9-88.9 70.9-149s-27.7-113.8-70.9-149zm-60.5 74.5c-10.3-8.4-25.4-6.8-33.8 3.5s-6.8 25.4 3.5 33.8C361.1 227.6 368 241 368 256s-6.9 28.4-17.7 37.3c-10.3 8.4-11.8 23.5-3.5 33.8s23.5 11.8 33.8 3.5C402.1 312.9 416 286.1 416 256s-13.9-56.9-35.5-74.5z"/></svg>',"volume-low":'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512"><!--!Font Awesome Free v7.2.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2026 Fonticons, Inc.--><path d="M48 352l48 0 134.1 119.2c6.4 5.7 14.6 8.8 23.1 8.8 19.2 0 34.8-15.6 34.8-34.8l0-378.4c0-19.2-15.6-34.8-34.8-34.8-8.5 0-16.7 3.1-23.1 8.8L96 160 48 160c-26.5 0-48 21.5-48 48l0 96c0 26.5 21.5 48 48 48zM380.6 181.5c-10.3-8.4-25.4-6.8-33.8 3.5s-6.8 25.4 3.5 33.8C361.1 227.6 368 241 368 256s-6.9 28.4-17.7 37.3c-10.3 8.4-11.8 23.5-3.5 33.8s23.5 11.8 33.8 3.5C402.1 312.9 416 286.1 416 256s-13.9-56.9-35.5-74.5z"/></svg>',"volume-xmark":'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 576 512"><!--!Font Awesome Free v7.2.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2026 Fonticons, Inc.--><path d="M48 352l48 0 134.1 119.2c6.4 5.7 14.6 8.8 23.1 8.8 19.2 0 34.8-15.6 34.8-34.8l0-378.4c0-19.2-15.6-34.8-34.8-34.8-8.5 0-16.7 3.1-23.1 8.8L96 160 48 160c-26.5 0-48 21.5-48 48l0 96c0 26.5 21.5 48 48 48zM367 175c-9.4 9.4-9.4 24.6 0 33.9l47 47-47 47c-9.4 9.4-9.4 24.6 0 33.9s24.6 9.4 33.9 0l47-47 47 47c9.4 9.4 24.6 9.4 33.9 0s9.4-24.6 0-33.9l-47-47 47-47c9.4-9.4 9.4-24.6 0-33.9s-24.6-9.4-33.9 0l-47 47-47-47c-9.4-9.4-24.6-9.4-33.9 0z"/></svg>',xmark:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 384 512"><!--! Font Awesome Free 7.0.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2025 Fonticons, Inc. --><path d="M55.1 73.4c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3L147.2 256 9.9 393.4c-12.5 12.5-12.5 32.8 0 45.3s32.8 12.5 45.3 0L192.5 301.3 329.9 438.6c12.5 12.5 32.8 12.5 45.3 0s12.5-32.8 0-45.3L237.8 256 375.1 118.6c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0L192.5 210.7 55.1 73.4z"/></svg>'},regular:{calendar:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640"><!--!Font Awesome Free v7.2.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2026 Fonticons, Inc.--><path d="M216 64C229.3 64 240 74.7 240 88L240 128L400 128L400 88C400 74.7 410.7 64 424 64C437.3 64 448 74.7 448 88L448 128L480 128C515.3 128 544 156.7 544 192L544 480C544 515.3 515.3 544 480 544L160 544C124.7 544 96 515.3 96 480L96 192C96 156.7 124.7 128 160 128L192 128L192 88C192 74.7 202.7 64 216 64zM216 176L160 176C151.2 176 144 183.2 144 192L144 240L496 240L496 192C496 183.2 488.8 176 480 176L216 176zM144 288L144 480C144 488.8 151.2 496 160 496L480 496C488.8 496 496 488.8 496 480L496 288L144 288z"/></svg>',"circle-question":'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><!--! Font Awesome Free 7.0.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2025 Fonticons, Inc. --><path d="M464 256a208 208 0 1 0 -416 0 208 208 0 1 0 416 0zM0 256a256 256 0 1 1 512 0 256 256 0 1 1 -512 0zm256-80c-17.7 0-32 14.3-32 32 0 13.3-10.7 24-24 24s-24-10.7-24-24c0-44.2 35.8-80 80-80s80 35.8 80 80c0 47.2-36 67.2-56 74.5l0 3.8c0 13.3-10.7 24-24 24s-24-10.7-24-24l0-8.1c0-20.5 14.8-35.2 30.1-40.2 6.4-2.1 13.2-5.5 18.2-10.3 4.3-4.2 7.7-10 7.7-19.6 0-17.7-14.3-32-32-32zM224 368a32 32 0 1 1 64 0 32 32 0 1 1 -64 0z"/></svg>',"circle-xmark":'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><!--! Font Awesome Free 7.0.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2025 Fonticons, Inc. --><path d="M256 48a208 208 0 1 1 0 416 208 208 0 1 1 0-416zm0 464a256 256 0 1 0 0-512 256 256 0 1 0 0 512zM167 167c-9.4 9.4-9.4 24.6 0 33.9l55 55-55 55c-9.4 9.4-9.4 24.6 0 33.9s24.6 9.4 33.9 0l55-55 55 55c9.4 9.4 24.6 9.4 33.9 0s9.4-24.6 0-33.9l-55-55 55-55c9.4-9.4 9.4-24.6 0-33.9s-24.6-9.4-33.9 0l-55 55-55-55c-9.4-9.4-24.6-9.4-33.9 0z"/></svg>',clock:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640"><!--!Font Awesome Free v7.2.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2026 Fonticons, Inc.--><path d="M528 320C528 434.9 434.9 528 320 528C205.1 528 112 434.9 112 320C112 205.1 205.1 112 320 112C434.9 112 528 205.1 528 320zM64 320C64 461.4 178.6 576 320 576C461.4 576 576 461.4 576 320C576 178.6 461.4 64 320 64C178.6 64 64 178.6 64 320zM296 184L296 320C296 328 300 335.5 306.7 340L402.7 404C413.7 411.4 428.6 408.4 436 397.3C443.4 386.2 440.4 371.4 429.3 364L344 307.2L344 184C344 170.7 333.3 160 320 160C306.7 160 296 170.7 296 184z"/></svg>',copy:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512"><!--! Font Awesome Free 7.0.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2025 Fonticons, Inc. --><path d="M384 336l-192 0c-8.8 0-16-7.2-16-16l0-256c0-8.8 7.2-16 16-16l133.5 0c4.2 0 8.3 1.7 11.3 4.7l58.5 58.5c3 3 4.7 7.1 4.7 11.3L400 320c0 8.8-7.2 16-16 16zM192 384l192 0c35.3 0 64-28.7 64-64l0-197.5c0-17-6.7-33.3-18.7-45.3L370.7 18.7C358.7 6.7 342.5 0 325.5 0L192 0c-35.3 0-64 28.7-64 64l0 256c0 35.3 28.7 64 64 64zM64 128c-35.3 0-64 28.7-64 64L0 448c0 35.3 28.7 64 64 64l192 0c35.3 0 64-28.7 64-64l0-16-48 0 0 16c0 8.8-7.2 16-16 16L64 464c-8.8 0-16-7.2-16-16l0-256c0-8.8 7.2-16 16-16l16 0 0-48-16 0z"/></svg>',eye:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 576 512"><!--! Font Awesome Free 7.0.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2025 Fonticons, Inc. --><path d="M288 80C222.8 80 169.2 109.6 128.1 147.7 89.6 183.5 63 226 49.4 256 63 286 89.6 328.5 128.1 364.3 169.2 402.4 222.8 432 288 432s118.8-29.6 159.9-67.7C486.4 328.5 513 286 526.6 256 513 226 486.4 183.5 447.9 147.7 406.8 109.6 353.2 80 288 80zM95.4 112.6C142.5 68.8 207.2 32 288 32s145.5 36.8 192.6 80.6c46.8 43.5 78.1 95.4 93 131.1 3.3 7.9 3.3 16.7 0 24.6-14.9 35.7-46.2 87.7-93 131.1-47.1 43.7-111.8 80.6-192.6 80.6S142.5 443.2 95.4 399.4c-46.8-43.5-78.1-95.4-93-131.1-3.3-7.9-3.3-16.7 0-24.6 14.9-35.7 46.2-87.7 93-131.1zM288 336c44.2 0 80-35.8 80-80 0-29.6-16.1-55.5-40-69.3-1.4 59.7-49.6 107.9-109.3 109.3 13.8 23.9 39.7 40 69.3 40zm-79.6-88.4c2.5 .3 5 .4 7.6 .4 35.3 0 64-28.7 64-64 0-2.6-.2-5.1-.4-7.6-37.4 3.9-67.2 33.7-71.1 71.1zm45.6-115c10.8-3 22.2-4.5 33.9-4.5 8.8 0 17.5 .9 25.8 2.6 .3 .1 .5 .1 .8 .2 57.9 12.2 101.4 63.7 101.4 125.2 0 70.7-57.3 128-128 128-61.6 0-113-43.5-125.2-101.4-1.8-8.6-2.8-17.5-2.8-26.6 0-11 1.4-21.8 4-32 .2-.7 .3-1.3 .5-1.9 11.9-43.4 46.1-77.6 89.5-89.5z"/></svg>',"eye-slash":'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 576 512"><!--! Font Awesome Free 7.0.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2025 Fonticons, Inc. --><path d="M41-24.9c-9.4-9.4-24.6-9.4-33.9 0S-2.3-.3 7 9.1l528 528c9.4 9.4 24.6 9.4 33.9 0s9.4-24.6 0-33.9l-96.4-96.4c2.7-2.4 5.4-4.8 8-7.2 46.8-43.5 78.1-95.4 93-131.1 3.3-7.9 3.3-16.7 0-24.6-14.9-35.7-46.2-87.7-93-131.1-47.1-43.7-111.8-80.6-192.6-80.6-56.8 0-105.6 18.2-146 44.2L41-24.9zM176.9 111.1c32.1-18.9 69.2-31.1 111.1-31.1 65.2 0 118.8 29.6 159.9 67.7 38.5 35.7 65.1 78.3 78.6 108.3-13.6 30-40.2 72.5-78.6 108.3-3.1 2.8-6.2 5.6-9.4 8.4L393.8 328c14-20.5 22.2-45.3 22.2-72 0-70.7-57.3-128-128-128-26.7 0-51.5 8.2-72 22.2l-39.1-39.1zm182 182l-108-108c11.1-5.8 23.7-9.1 37.1-9.1 44.2 0 80 35.8 80 80 0 13.4-3.3 26-9.1 37.1zM103.4 173.2l-34-34c-32.6 36.8-55 75.8-66.9 104.5-3.3 7.9-3.3 16.7 0 24.6 14.9 35.7 46.2 87.7 93 131.1 47.1 43.7 111.8 80.6 192.6 80.6 37.3 0 71.2-7.9 101.5-20.6L352.2 422c-20 6.4-41.4 10-64.2 10-65.2 0-118.8-29.6-159.9-67.7-38.5-35.7-65.1-78.3-78.6-108.3 10.4-23.1 28.6-53.6 54-82.8z"/></svg>',star:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 576 512"><!--! Font Awesome Free 7.0.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2025 Fonticons, Inc. --><path d="M288.1-32c9 0 17.3 5.1 21.4 13.1L383 125.3 542.9 150.7c8.9 1.4 16.3 7.7 19.1 16.3s.5 18-5.8 24.4L441.7 305.9 467 465.8c1.4 8.9-2.3 17.9-9.6 23.2s-17 6.1-25 2L288.1 417.6 143.8 491c-8 4.1-17.7 3.3-25-2s-11-14.2-9.6-23.2L134.4 305.9 20 191.4c-6.4-6.4-8.6-15.8-5.8-24.4s10.1-14.9 19.1-16.3l159.9-25.4 73.6-144.2c4.1-8 12.4-13.1 21.4-13.1zm0 76.8L230.3 158c-3.5 6.8-10 11.6-17.6 12.8l-125.5 20 89.8 89.9c5.4 5.4 7.9 13.1 6.7 20.7l-19.8 125.5 113.3-57.6c6.8-3.5 14.9-3.5 21.8 0l113.3 57.6-19.8-125.5c-1.2-7.6 1.3-15.3 6.7-20.7l89.8-89.9-125.5-20c-7.6-1.2-14.1-6-17.6-12.8L288.1 44.8z"/></svg>'}},On={name:"system",resolver:(t,e="classic",o="solid")=>{let n=ro[o][t]??ro.regular[t]??ro.regular["circle-question"];if(n)return Rn(n);return""},mutator:(t)=>{if(!t.hasAttribute("fill"))t.setAttribute("fill","currentColor")}},hi=On;/*! Copyright 2026 Fonticons, Inc. - https://webawesome.com/license */var Tn="classic",In=[mi,hi],pi=new Set;function fi(t){pi.add(t)}function gi(t){pi.delete(t)}function ve(t){return In.find((e)=>e.name===t)}function vi(){return Tn}var{I:Us}=Vo;var wi=(t,e)=>e===void 0?t?._$litType$!==void 0:t?._$litType$===e;/*! Copyright 2026 Fonticons, Inc. - https://webawesome.com/license */var Qt=Symbol(),we=Symbol(),ao,so=new Map,R=class extends _{constructor(){super(...arguments);this.svg=null,this.autoWidth=!1,this.swapOpacity=!1,this.label="",this.library="default",this.rotate=0,this.resolveIcon=async(t,e)=>{let o;if(e?.spriteSheet){if(!this.hasUpdated)await this.updateComplete;this.svg=A`<svg part="svg">
        <use part="use" href="${t}"></use>
      </svg>`,await this.updateComplete;let i=this.shadowRoot.querySelector("[part='svg']");if(typeof e.mutator==="function")e.mutator(i,this);return this.svg}try{if(o=await fetch(t,{mode:"cors"}),!o.ok)return o.status===410?Qt:we}catch{return we}try{let i=document.createElement("div");i.innerHTML=await o.text();let n=i.firstElementChild;if(n?.tagName?.toLowerCase()!=="svg")return Qt;if(!ao)ao=new DOMParser;let a=ao.parseFromString(n.outerHTML,"text/html").body.querySelector("svg");if(!a)return Qt;return a.part.add("svg"),document.adoptNode(a)}catch{return Qt}}}connectedCallback(){super.connectedCallback(),fi(this)}firstUpdated(t){if(super.firstUpdated(t),this.hasAttribute("rotate"))this.style.setProperty("--rotate-angle",`${this.rotate}deg`);this.setIcon()}disconnectedCallback(){super.disconnectedCallback(),gi(this)}async getIconSource(){let t=ve(this.library),e=this.family||vi();if(this.name&&t){let o=this.canvas==="auto"||this.autoWidth,i;try{i=await t.resolver(this.name,e,this.variant,o)}catch{i=void 0}return{url:i,fromLibrary:!0}}return{url:this.src,fromLibrary:!1}}handleLabelChange(){if(typeof this.label==="string"&&this.label.length>0)this.setAttribute("role","img"),this.setAttribute("aria-label",this.label),this.removeAttribute("aria-hidden");else this.removeAttribute("role"),this.removeAttribute("aria-label"),this.setAttribute("aria-hidden","true")}async setIcon(){let{url:t,fromLibrary:e}=await this.getIconSource(),o=e?ve(this.library):void 0;if(!t){this.svg=null;return}let i=so.get(t);if(!i)i=this.resolveIcon(t,o),so.set(t,i);let n=await i;if(n===we)so.delete(t);let r=await this.getIconSource();if(t!==r.url)return;if(wi(n)){this.svg=n;return}switch(n){case we:case Qt:this.svg=null,this.dispatchEvent(new ai);break;default:this.svg=n.cloneNode(!0),o?.mutator?.(this.svg,this),this.dispatchEvent(new si)}}willUpdate(t){if(!this.style)this.setStyleProperty("--rotate-angle",`${this.rotate}deg`);return super.willUpdate(t)}updated(t){super.updated(t);let e=ve(this.library);if(this.hasAttribute("rotate"))this.style.setProperty("--rotate-angle",`${this.rotate}deg`);let o=this.shadowRoot?.querySelector("svg");if(o)e?.mutator?.(o,this)}render(){if(this.hasUpdated)return this.svg;return A`<svg part="svg" width="16" height="16" viewBox="0 0 16 16"></svg>`}};R.css=li;l([St()],R.prototype,"svg",2);l([m({reflect:!0})],R.prototype,"name",2);l([m({reflect:!0})],R.prototype,"family",2);l([m({reflect:!0})],R.prototype,"variant",2);l([m({reflect:!0})],R.prototype,"canvas",2);l([m({attribute:"auto-width",type:Boolean,reflect:!0})],R.prototype,"autoWidth",2);l([m({attribute:"swap-opacity",type:Boolean,reflect:!0})],R.prototype,"swapOpacity",2);l([m()],R.prototype,"src",2);l([m()],R.prototype,"label",2);l([m({reflect:!0})],R.prototype,"library",2);l([m({type:Number,reflect:!0})],R.prototype,"rotate",2);l([m({type:String,reflect:!0})],R.prototype,"flip",2);l([m({type:String,reflect:!0})],R.prototype,"animation",2);l([T("label")],R.prototype,"handleLabelChange",1);l([T(["family","name","library","variant","src","autoWidth","canvas","swapOpacity"],{waitUntilFirstUpdate:!0})],R.prototype,"setIcon",1);R=l([F("wa-icon")],R);/*! Copyright 2026 Fonticons, Inc. - https://webawesome.com/license *//*! Copyright 2026 Fonticons, Inc. - https://webawesome.com/license */var bi=class{constructor(t,e){this.element=t,this.callback=e}start(...t){if(Z)return;this.observer??(this.observer=new ResizeObserver(()=>this.check())),this.observer.observe(this.element);for(let e of t)this.observer.observe(e);this.initialCheckHandle??(this.initialCheckHandle=requestAnimationFrame(()=>{this.initialCheckHandle=void 0,this.check()}))}stop(){if(this.initialCheckHandle!==void 0)cancelAnimationFrame(this.initialCheckHandle),this.initialCheckHandle=void 0;this.observer?.disconnect()}check(){this.callback(this.element.getClientRects().length>0)}};/*! Copyright 2026 Fonticons, Inc. - https://webawesome.com/license */function yi(t,e){let o=e.getBoundingClientRect();return t.clientX>=o.left&&t.clientX<=o.right&&t.clientY>=o.top&&t.clientY<=o.bottom}var lo=new Set;function Dn(){let t=document.documentElement.clientWidth;return Math.abs(window.innerWidth-t)}function Bn(){let t=Number(getComputedStyle(document.body).paddingRight.replace(/px/,""));if(isNaN(t)||!t)return 0;return t}function be(t){if(lo.add(t),!document.documentElement.classList.contains("wa-scroll-lock")){let e=Dn()+Bn(),o=getComputedStyle(document.documentElement).scrollbarGutter;if(!o||o==="auto")o="stable";if(e<2)o="";document.documentElement.style.setProperty("--wa-scroll-lock-gutter",o),document.documentElement.classList.add("wa-scroll-lock"),document.documentElement.style.setProperty("--wa-scroll-lock-size",`${e}px`)}}function ye(t){if(lo.delete(t),lo.size===0)document.documentElement.classList.remove("wa-scroll-lock"),document.documentElement.style.removeProperty("--wa-scroll-lock-size")}/*! Copyright 2026 Fonticons, Inc. - https://webawesome.com/license */function Ci(t){return t.split(" ").map((e)=>e.trim()).filter((e)=>e!=="")}/*! Copyright 2026 Fonticons, Inc. - https://webawesome.com/license */var Ce=class extends Event{constructor(){super("wa-show",{bubbles:!0,cancelable:!0,composed:!0})}};/*! Copyright 2026 Fonticons, Inc. - https://webawesome.com/license */var xe=class extends Event{constructor(t){super("wa-hide",{bubbles:!0,cancelable:!0,composed:!0});this.detail=t}};/*! Copyright 2026 Fonticons, Inc. - https://webawesome.com/license */var Le=class extends Event{constructor(){super("wa-after-hide",{bubbles:!0,cancelable:!1,composed:!0})}};/*! Copyright 2026 Fonticons, Inc. - https://webawesome.com/license */var Se=class extends Event{constructor(){super("wa-after-show",{bubbles:!0,cancelable:!1,composed:!0})}};/*! Copyright 2026 Fonticons, Inc. - https://webawesome.com/license */var xi=S`
  :host {
    --width: 31rem;
    --spacing: var(--wa-space-l);
    --backdrop-filter: none;
    --show-duration: var(--wa-transition-normal);
    --hide-duration: var(--wa-transition-normal);

    display: none;
  }

  :host([open]) {
    display: block;
  }

  .dialog {
    display: flex;
    flex-direction: column;
    top: 0;
    right: 0;
    bottom: 0;
    left: 0;
    width: var(--width);
    max-width: calc(100% - var(--wa-space-2xl));
    max-height: calc(100% - var(--wa-space-2xl));
    color: inherit;
    background-color: var(--wa-color-surface-raised);
    border-radius: var(--wa-panel-border-radius);
    border: none;
    box-shadow: var(--wa-shadow-l);
    padding: 0;
    margin: auto;

    &.show {
      animation: show-dialog var(--show-duration) ease;

      &::backdrop {
        animation: show-backdrop var(--show-duration, 200ms) ease;
      }
    }

    &.hide {
      animation: show-dialog var(--hide-duration) ease reverse;

      &::backdrop {
        animation: show-backdrop var(--hide-duration, 200ms) ease reverse;
      }
    }

    &.pulse {
      animation: pulse 250ms ease;
    }
  }

  .dialog:focus {
    outline: none;
  }

  /* Ensure there's enough vertical padding for phones that don't update vh when chrome appears (e.g. iPhone) */
  @media screen and (max-width: 420px) {
    .dialog {
      max-height: 80vh;
    }
  }

  .open {
    display: flex;
    opacity: 1;
  }

  .header {
    flex: 0 0 auto;
    display: flex;
    flex-wrap: nowrap;

    padding-inline-start: var(--spacing);
    padding-block-end: 0;

    /* Subtract the close button's padding so that the X is visually aligned with the edges of the dialog content */
    padding-inline-end: calc(var(--spacing) - var(--wa-form-control-padding-block));
    padding-block-start: calc(var(--spacing) - var(--wa-form-control-padding-block));
  }

  .title {
    align-self: center;
    flex: 1 1 auto;
    font-family: inherit;
    font-size: var(--wa-font-size-l);
    font-weight: var(--wa-font-weight-heading);
    line-height: var(--wa-line-height-condensed);
    margin: 0;
  }

  .header-actions {
    align-self: start;
    display: flex;
    flex-shrink: 0;
    flex-wrap: wrap;
    justify-content: end;
    gap: var(--wa-space-2xs);
    padding-inline-start: var(--spacing);
  }

  .header-actions wa-button,
  .header-actions ::slotted(wa-button) {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
  }

  .body {
    flex: 1 1 auto;
    display: block;
    padding: var(--spacing);
    overflow: auto;
    -webkit-overflow-scrolling: touch;

    &:focus {
      outline: none;
    }

    &:focus-visible {
      outline: var(--wa-focus-ring);
      outline-offset: var(--wa-focus-ring-offset);
    }
  }

  .footer {
    flex: 0 0 auto;
    display: flex;
    flex-wrap: wrap;
    gap: var(--wa-space-xs);
    justify-content: end;
    padding: var(--spacing);
    padding-block-start: 0;
  }

  .footer ::slotted(wa-button:not(:first-of-type)) {
    margin-inline-start: var(--wa-spacing-xs);
  }

  .dialog::backdrop {
    /*
      NOTE: the ::backdrop element doesn't inherit properly in Safari yet, but it will in 17.4! At that time, we can
      remove the fallback values here.
    */
    background-color: var(--wa-color-overlay-modal, rgb(0 0 0 / 0.25));
    backdrop-filter: var(--backdrop-filter);
  }

  @keyframes pulse {
    0% {
      scale: 1;
    }
    50% {
      scale: 1.02;
    }
    100% {
      scale: 1;
    }
  }

  @keyframes show-dialog {
    from {
      opacity: 0;
      scale: 0.8;
    }
    to {
      opacity: 1;
      scale: 1;
    }
  }

  @keyframes show-backdrop {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  @media (forced-colors: active) {
    .dialog {
      border: solid 1px white;
    }
  }
`;/*! Copyright 2026 Fonticons, Inc. - https://webawesome.com/license */var zt=[];function Ae(t){Bt(t),zt.push(t)}function Bt(t){for(let e=zt.length-1;e>=0;e--)if(zt[e]===t){zt.splice(e,1);break}}function Zt(t){return zt.length>0&&zt[zt.length-1]===t}/*! Copyright 2026 Fonticons, Inc. - https://webawesome.com/license */function j(t,e){return new Promise((o)=>{let i=new AbortController,{signal:n}=i;if(t.classList.contains(e))return;t.classList.add(e);let r=!1,a=()=>{if(r)return;r=!0,t.classList.remove(e),o(),i.abort()};t.addEventListener("animationend",a,{once:!0,signal:n}),t.addEventListener("animationcancel",a,{once:!0,signal:n}),requestAnimationFrame(()=>{if(!r&&t.getAnimations().length===0)a()})})}/*! Copyright 2026 Fonticons, Inc. - https://webawesome.com/license */var U=class extends _{constructor(){super(...arguments);this.localize=new tt(this),this.hasSlotController=new ht(this,"footer","header-actions","label"),this.renderedWatcher=new bi(this,(t)=>this.handleRenderedChange(t)),this.open=!1,this.label="",this.withoutHeader=!1,this.lightDismiss=!1,this.withFooter=!1,this.withLabel=!1,this.handleDocumentKeyDown=(t)=>{if(t.key==="Escape"&&this.open&&Zt(this))t.preventDefault(),t.stopPropagation(),this.requestClose(this.dialog)}}firstUpdated(t){if(super.firstUpdated(t),this.open)this.addOpenListeners(),this.dialog.showModal(),be(this),this.renderedWatcher.start(this.dialog)}disconnectedCallback(){super.disconnectedCallback(),this.renderedWatcher.stop(),ye(this),this.removeOpenListeners()}async requestClose(t){let e=new xe({source:t});if(this.dispatchEvent(e),e.defaultPrevented){this.open=!0,j(this.dialog,"pulse");return}this.removeOpenListeners(),await j(this.dialog,"hide"),this.open=!1,this.dialog.close(),ye(this),this.renderedWatcher.stop();let o=this.originalTrigger;if(typeof o?.focus==="function")setTimeout(()=>o.focus());this.dispatchEvent(new Le)}addOpenListeners(){document.addEventListener("keydown",this.handleDocumentKeyDown),Ae(this)}removeOpenListeners(){document.removeEventListener("keydown",this.handleDocumentKeyDown),Bt(this)}handleDialogCancel(t){if(t.preventDefault(),!this.dialog.classList.contains("hide")&&t.target===this.dialog&&Zt(this))this.requestClose(this.dialog)}handleDialogClick(t){let o=t.target.closest('[data-dialog="close"]');if(o)t.stopPropagation(),this.requestClose(o)}async handleDialogPointerDown(t){if(t.target===this.dialog&&!yi(t,this.dialog))if(this.lightDismiss)this.requestClose(this.dialog);else await j(this.dialog,"pulse")}handleRenderedChange(t){if(!this.open){this.renderedWatcher.stop();return}if(!t&&this.dialog.open)this.removeOpenListeners(),this.dialog.close(),ye(this);else if(t&&!this.dialog.open)this.addOpenListeners(),this.dialog.showModal(),be(this)}handleOpenChange(){if(this.open&&!this.dialog.open)this.show();else if(!this.open&&this.dialog.open)this.open=!0,this.requestClose(this.dialog);else if(!this.open)this.renderedWatcher.stop()}async show(){let t=new Ce;if(this.dispatchEvent(t),t.defaultPrevented){this.open=!1;return}this.addOpenListeners(),this.originalTrigger=document.activeElement,this.open=!0,this.dialog.showModal(),be(this),this.renderedWatcher.start(this.dialog),requestAnimationFrame(()=>{let e=this.querySelector("[autofocus]");if(e&&typeof e.focus==="function")e.focus();else this.dialog.focus()}),await j(this.dialog,"show"),this.dispatchEvent(new Se)}render(){let t=!this.withoutHeader,e=this.hasSlotController.test("footer","withFooter"),o=this.label.length>0||this.hasSlotController.test("label","withLabel");return A`
      <dialog
        part="dialog"
        aria-labelledby=${M(t&&o?"title":void 0)}
        aria-label=${M(!t&&this.label?this.label:void 0)}
        class=${$t({dialog:!0,open:this.open})}
        @cancel=${this.handleDialogCancel}
        @click=${this.handleDialogClick}
        @pointerdown=${this.handleDialogPointerDown}
      >
        ${t?A`
              <div part="header" class="header">
                <h2 part="title" class="title" id="title">
                  <!-- If there's no label, use an invisible character to prevent the header from collapsing -->
                  <slot name="label"> ${this.label.length>0?this.label:String.fromCharCode(8203)} </slot>
                </h2>
                <div part="header-actions" class="header-actions">
                  <slot name="header-actions"></slot>
                  <wa-button
                    part="close-button"
                    exportparts="base:close-button__base"
                    class="close"
                    appearance="plain"
                    @click="${(i)=>this.requestClose(i.target)}"
                  >
                    <wa-icon
                      name="xmark"
                      label=${this.localize.term("close")}
                      library="system"
                      variant="solid"
                    ></wa-icon>
                  </wa-button>
                </div>
              </div>
            `:""}

        <div part="body" class="body"><slot></slot></div>

        <!-- Use a hidden element so we still get "slotchange" events. -->
        <div part="footer" class="footer" ?hidden=${!e}>
          <slot name="footer"></slot>
        </div>
      </dialog>
    `}};U.css=xi;l([D(".dialog")],U.prototype,"dialog",2);l([m({type:Boolean,reflect:!0})],U.prototype,"open",2);l([m({reflect:!0})],U.prototype,"label",2);l([m({attribute:"without-header",type:Boolean,reflect:!0})],U.prototype,"withoutHeader",2);l([m({attribute:"light-dismiss",type:Boolean})],U.prototype,"lightDismiss",2);l([m({attribute:"with-footer",type:Boolean})],U.prototype,"withFooter",2);l([m({attribute:"with-label",type:Boolean})],U.prototype,"withLabel",2);l([T("open",{waitUntilFirstUpdate:!0})],U.prototype,"handleOpenChange",1);U=l([F("wa-dialog")],U);if(!Z)document.addEventListener("click",(t)=>{let e=t.target.closest("[data-dialog]");if(e instanceof Element){let[o,i]=Ci(e.getAttribute("data-dialog")||"");if(o==="open"&&i?.length){let r=e.getRootNode().getElementById(i);if(r?.localName==="wa-dialog")r.open=!0;else console.warn(`A dialog with an ID of "${i}" could not be found in this document.`)}}}),document.addEventListener("pointerdown",()=>{});/*! Copyright 2026 Fonticons, Inc. - https://webawesome.com/license *//*! Copyright 2026 Fonticons, Inc. - https://webawesome.com/license */var Li=class extends Event{constructor(t){super("wa-select",{bubbles:!0,cancelable:!0,composed:!0});this.detail=t}};/*! Copyright 2026 Fonticons, Inc. - https://webawesome.com/license */function*co(t=document.activeElement){if(t===null||t===void 0)return;if(yield t,"shadowRoot"in t&&t.shadowRoot&&t.shadowRoot.mode!=="closed")yield*co(t.shadowRoot.activeElement)}/*! Copyright 2026 Fonticons, Inc. - https://webawesome.com/license */var Si=S`
  :host {
    --show-duration: var(--wa-transition-fast);
    --hide-duration: var(--wa-transition-fast);
    display: contents;
  }

  #menu {
    display: flex;
    flex-direction: column;
    width: max-content;
    margin: 0;
    padding: 0.25em;
    border: var(--wa-border-style) var(--wa-border-width-s) var(--wa-color-surface-border);
    border-radius: var(--wa-border-radius-m);
    background-color: var(--wa-color-surface-raised);
    box-shadow: var(--wa-shadow-m);
    color: var(--wa-color-text-normal);
    text-align: start;
    user-select: none;
    overflow: auto;
    max-width: var(--auto-size-available-width) !important;
    max-height: var(--auto-size-available-height) !important;

    &.show {
      animation: show var(--show-duration) ease;
    }

    &.hide {
      animation: show var(--hide-duration) ease reverse;
    }

    ::slotted(h1),
    ::slotted(h2),
    ::slotted(h3),
    ::slotted(h4),
    ::slotted(h5),
    ::slotted(h6) {
      display: block !important;
      margin: 0.25em 0 !important;
      padding: 0.25em 0.75em !important;
      color: var(--wa-color-text-quiet);
      font-family: var(--wa-font-family-body) !important;
      font-weight: var(--wa-font-weight-semibold) !important;
      font-size: var(--wa-font-size-smaller) !important;
    }

    ::slotted(wa-divider) {
      --spacing: 0.25em; /* Component-specific, left as-is */
    }
  }

  wa-popup[data-current-placement^='top'] #menu {
    transform-origin: bottom;
  }

  wa-popup[data-current-placement^='bottom'] #menu {
    transform-origin: top;
  }

  wa-popup[data-current-placement^='left'] #menu {
    transform-origin: right;
  }

  wa-popup[data-current-placement^='right'] #menu {
    transform-origin: left;
  }

  wa-popup[data-current-placement='left-start'] #menu {
    transform-origin: right top;
  }

  wa-popup[data-current-placement='left-end'] #menu {
    transform-origin: right bottom;
  }

  wa-popup[data-current-placement='right-start'] #menu {
    transform-origin: left top;
  }

  wa-popup[data-current-placement='right-end'] #menu {
    transform-origin: left bottom;
  }

  @keyframes show {
    from {
      scale: 0.9;
      opacity: 0;
    }
    to {
      scale: 1;
      opacity: 1;
    }
  }
`;var Ai="useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict";var Ei=(t=21)=>{let e="",o=crypto.getRandomValues(new Uint8Array(t|=0));while(t--)e+=Ai[o[t]&63];return e};/*! Copyright 2026 Fonticons, Inc. - https://webawesome.com/license */function $i(t=""){return`${t}${Ei()}`}var{min:et,max:X,round:te,floor:ee}=Math,ot=(t)=>({x:t,y:t}),Nn={left:"right",right:"left",bottom:"top",top:"bottom"};function uo(t,e,o){return X(t,et(e,o))}function kt(t,e){return typeof t==="function"?t(e):t}function pt(t){return t.split("-")[0]}function _t(t){return t.split("-")[1]}function mo(t){return t==="x"?"y":"x"}function $e(t){return t==="y"?"height":"width"}function it(t){let e=t[0];return e==="t"||e==="b"?"y":"x"}function ze(t){return mo(it(t))}function _i(t,e,o){if(o===void 0)o=!1;let i=_t(t),n=ze(t),r=$e(n),a=n==="x"?i===(o?"end":"start")?"right":"left":i==="start"?"bottom":"top";if(e.reference[r]>e.floating[r])a=Jt(a);return[a,Jt(a)]}function Pi(t){let e=Jt(t);return[Ee(t),e,Ee(e)]}function Ee(t){return t.includes("start")?t.replace("start","end"):t.replace("end","start")}var zi=["left","right"],ki=["right","left"],qn=["top","bottom"],Un=["bottom","top"];function Hn(t,e,o){switch(t){case"top":case"bottom":if(o)return e?ki:zi;return e?zi:ki;case"left":case"right":return e?qn:Un;default:return[]}}function Fi(t,e,o,i){let n=_t(t),r=Hn(pt(t),o==="start",i);if(n){if(r=r.map((a)=>a+"-"+n),e)r=r.concat(r.map(Ee))}return r}function Jt(t){let e=pt(t);return Nn[e]+t.slice(e.length)}function Vn(t){var e,o,i,n;return{top:(e=t.top)!=null?e:0,right:(o=t.right)!=null?o:0,bottom:(i=t.bottom)!=null?i:0,left:(n=t.left)!=null?n:0}}function ho(t){return typeof t!=="number"?Vn(t):{top:t,right:t,bottom:t,left:t}}function Pt(t){let{x:e,y:o,width:i,height:n}=t;return{width:i,height:n,top:o,left:e,right:e+i,bottom:o+n,x:e,y:o}}function Mi(t,e,o){let{reference:i,floating:n}=t,r=it(e),a=ze(e),s=$e(a),d=pt(e),u=r==="y",c=i.x+i.width/2-n.width/2,h=i.y+i.height/2-n.height/2,p=i[s]/2-n[s]/2,f;switch(d){case"top":f={x:c,y:i.y-n.height};break;case"bottom":f={x:c,y:i.y+i.height};break;case"right":f={x:i.x+i.width,y:h};break;case"left":f={x:i.x-n.width,y:h};break;default:f={x:i.x,y:i.y}}let g=_t(e);if(g)f[a]+=p*(g==="end"?1:-1)*(o&&u?-1:1);return f}async function Ri(t,e){var o;if(e===void 0)e={};let{x:i,y:n,platform:r,rects:a,elements:s,strategy:d}=t,{boundary:u="clippingAncestors",rootBoundary:c="viewport",elementContext:h="floating",altBoundary:p=!1,padding:f=0}=kt(e,t),g=ho(f),y=s[p?h==="floating"?"reference":"floating":h],w=Pt(await r.getClippingRect({element:((o=await(r.isElement==null?void 0:r.isElement(y)))!=null?o:!0)?y:y.contextElement||await(r.getDocumentElement==null?void 0:r.getDocumentElement(s.floating)),boundary:u,rootBoundary:c,strategy:d})),C=h==="floating"?{x:i,y:n,width:a.floating.width,height:a.floating.height}:a.reference,L=await(r.getOffsetParent==null?void 0:r.getOffsetParent(s.floating)),E=await(r.isElement==null?void 0:r.isElement(L))&&await(r.getScale==null?void 0:r.getScale(L))||{x:1,y:1},N=Pt(r.convertOffsetParentRelativeRectToViewportRelativeRect?await r.convertOffsetParentRelativeRectToViewportRelativeRect({elements:s,rect:C,offsetParent:L,strategy:d}):C);return{top:(w.top-N.top+g.top)/E.y,bottom:(N.bottom-w.bottom+g.bottom)/E.y,left:(w.left-N.left+g.left)/E.x,right:(N.right-w.right+g.right)/E.x}}var Wn=50,Oi=async(t,e,o)=>{let{placement:i="bottom",strategy:n="absolute",middleware:r=[],platform:a}=o,s=a.detectOverflow?a:{...a,detectOverflow:Ri},d=await(a.isRTL==null?void 0:a.isRTL(e)),u=await a.getElementRects({reference:t,floating:e,strategy:n}),{x:c,y:h}=Mi(u,i,d),p=i,f=0,g={};for(let v=0;v<r.length;v++){let y=r[v];if(!y)continue;let{name:w,fn:C}=y,{x:L,y:E,data:N,reset:k}=await C({x:c,y:h,initialPlacement:i,placement:p,strategy:n,middlewareData:g,rects:u,platform:s,elements:{reference:t,floating:e}});if(c=L!=null?L:c,h=E!=null?E:h,g[w]={...g[w],...N},k&&f<Wn){if(f++,typeof k==="object"){if(k.placement)p=k.placement;if(k.rects)u=k.rects===!0?await a.getElementRects({reference:t,floating:e,strategy:n}):k.rects;({x:c,y:h}=Mi(u,p,d))}v=-1}}return{x:c,y:h,placement:p,strategy:n,middlewareData:g}},Ti=(t)=>({name:"arrow",options:t,async fn(e){let{x:o,y:i,placement:n,rects:r,platform:a,elements:s,middlewareData:d}=e,{element:u,padding:c=0}=kt(t,e)||{};if(u==null)return{};let h=ho(c),p={x:o,y:i},f=ze(n),g=$e(f),v=await a.getDimensions(u),y=f==="y",w=y?"top":"left",C=y?"bottom":"right",L=y?"clientHeight":"clientWidth",E=r.reference[g]+r.reference[f]-p[f]-r.floating[g],N=p[f]-r.reference[f],k=await(a.getOffsetParent==null?void 0:a.getOffsetParent(u)),q=k?k[L]:0;if(!q||!await(a.isElement==null?void 0:a.isElement(k)))q=s.floating[L]||r.floating[g];let H=E/2-N/2,G=q/2-v[g]/2-1,O=et(h[w],G),Ht=et(h[C],G),Vt=q-v[g]-Ht,Q=q/2-v[g]/2+H,V=uo(O,Q,Vt),vt=!d.arrow&&_t(n)!=null&&Q!==V&&r.reference[g]/2-(Q<O?O:Ht)-v[g]/2<0,rt=vt?Q<O?Q-O:Q-Vt:0;return{[f]:p[f]+rt,data:{[f]:V,centerOffset:Q-V-rt,...vt&&{alignmentOffset:rt}},reset:vt}}});var Ii=function(t){if(t===void 0)t={};return{name:"flip",options:t,async fn(e){var o,i;let{placement:n,middlewareData:r,rects:a,initialPlacement:s,platform:d,elements:u}=e,{mainAxis:c=!0,crossAxis:h=!0,fallbackPlacements:p,fallbackStrategy:f="bestFit",fallbackAxisSideDirection:g="none",flipAlignment:v=!0,...y}=kt(t,e);if((o=r.arrow)!=null&&o.alignmentOffset)return{};let w=pt(n),C=it(s),L=pt(s)===s,E=await(d.isRTL==null?void 0:d.isRTL(u.floating)),N=p||(L||!v?[Jt(s)]:Pi(s)),k=g!=="none";if(!p&&k)N.push(...Fi(s,v,g,E));let q=[s,...N],H=await d.detectOverflow(e,y),G=[],O=((i=r.flip)==null?void 0:i.overflows)||[];if(c)G.push(H[w]);if(h){let V=_i(n,a,E);G.push(H[V[0]],H[V[1]])}if(O=[...O,{placement:n,overflows:G}],!G.every((V)=>V<=0)){var Ht,Vt;let V=(((Ht=r.flip)==null?void 0:Ht.index)||0)+1,vt=q[V];if(vt){if(!(h==="alignment"?C!==it(vt):!1)||O.every((W)=>it(W.placement)===C?W.overflows[0]>0:!0))return{data:{index:V,overflows:O},reset:{placement:vt}}}let rt=(Vt=O.filter((wt)=>wt.overflows[0]<=0).sort((wt,W)=>wt.overflows[1]-W.overflows[1])[0])==null?void 0:Vt.placement;if(!rt)switch(f){case"bestFit":{var Q;let wt=(Q=O.filter((W)=>{if(k){let ut=it(W.placement);return ut===C||ut==="y"}return!0}).map((W)=>[W.placement,W.overflows.filter((ut)=>ut>0).reduce((ut,ln)=>ut+ln,0)]).sort((W,ut)=>W[1]-ut[1])[0])==null?void 0:Q[0];if(wt)rt=wt;break}case"initialPlacement":rt=s;break}if(n!==rt)return{reset:{placement:rt}}}return{}}}};var jn=new Set(["left","top"]);async function Xn(t,e){let{placement:o,platform:i,elements:n}=t,r=await(i.isRTL==null?void 0:i.isRTL(n.floating)),a=pt(o),s=_t(o),d=it(o)==="y",u=jn.has(a)?-1:1,c=r&&d?-1:1,h=kt(e,t),{mainAxis:p,crossAxis:f,alignmentAxis:g}=typeof h==="number"?{mainAxis:h,crossAxis:0,alignmentAxis:null}:{mainAxis:h.mainAxis||0,crossAxis:h.crossAxis||0,alignmentAxis:h.alignmentAxis};if(s&&typeof g==="number")f=s==="end"?g*-1:g;return d?{x:f*c,y:p*u}:{x:p*u,y:f*c}}var Di=function(t){if(t===void 0)t=0;return{name:"offset",options:t,async fn(e){var o,i;let{x:n,y:r,placement:a,middlewareData:s}=e,d=await Xn(e,t);if(a===((o=s.offset)==null?void 0:o.placement)&&(i=s.arrow)!=null&&i.alignmentOffset)return{};return{x:n+d.x,y:r+d.y,data:{...d,placement:a}}}}},Bi=function(t){if(t===void 0)t={};return{name:"shift",options:t,async fn(e){let{x:o,y:i,placement:n,platform:r}=e,{mainAxis:a=!0,crossAxis:s=!1,limiter:d={fn:(C)=>{let{x:L,y:E}=C;return{x:L,y:E}}},...u}=kt(t,e),c={x:o,y:i},h=await r.detectOverflow(e,u),p=it(n),f=mo(p),g=c[f],v=c[p],y=(C,L)=>uo(L+h[C==="y"?"top":"left"],L,L-h[C==="y"?"bottom":"right"]);if(a)g=y(f,g);if(s)v=y(p,v);let w=d.fn({...e,[f]:g,[p]:v});return{...w,data:{x:w.x-o,y:w.y-i,enabled:{[f]:a,[p]:s}}}}}};var Ni=function(t){if(t===void 0)t={};return{name:"size",options:t,async fn(e){let{placement:o,rects:i,platform:n,elements:r}=e,{apply:a=()=>{},...s}=kt(t,e),d=await n.detectOverflow(e,s),u=pt(o),c=_t(o),h=it(o)==="y",{width:p,height:f}=i.floating,g,v;if(u==="top"||u==="bottom")g=u,v=c===(await(n.isRTL==null?void 0:n.isRTL(r.floating))?"start":"end")?"left":"right";else v=u,g=c==="end"?"top":"bottom";let y=f-d.top-d.bottom,w=p-d.left-d.right,C=et(f-d[g],y),L=et(p-d[v],w),E=e.middlewareData.shift,N=!E,k=C,q=L;if(E!=null&&E.enabled.x)q=w;if(E!=null&&E.enabled.y)k=y;if(N&&!c)if(h)q=p-2*X(d.left,d.right);else k=f-2*X(d.top,d.bottom);await a({...e,availableWidth:q,availableHeight:k});let H=await n.getDimensions(r.floating);if(p!==H.width||f!==H.height)return{reset:{rects:!0}};return{}}}};function ke(){return typeof window<"u"}function Mt(t){if(Ui(t))return(t.nodeName||"").toLowerCase();return"#document"}function B(t){var e;return(t==null||(e=t.ownerDocument)==null?void 0:e.defaultView)||window}function nt(t){var e;return(e=(Ui(t)?t.ownerDocument:t.document)||window.document)==null?void 0:e.documentElement}function Ui(t){if(!ke())return!1;return t instanceof Node||t instanceof B(t).Node}function Y(t){if(!ke())return!1;return t instanceof Element||t instanceof B(t).Element}function dt(t){if(!ke())return!1;return t instanceof HTMLElement||t instanceof B(t).HTMLElement}function qi(t){if(!ke()||typeof ShadowRoot>"u")return!1;return t instanceof ShadowRoot||t instanceof B(t).ShadowRoot}function oe(t){let{overflow:e,overflowX:o,overflowY:i,display:n}=K(t);return/auto|scroll|overlay|hidden|clip/.test(e+i+o)&&n!=="inline"&&n!=="contents"}function Hi(t){return/^(table|td|th)$/.test(Mt(t))}function ie(t){try{if(t.matches(":popover-open"))return!0}catch(e){}try{return t.matches(":modal")}catch(e){return!1}}var Yn=/transform|translate|scale|rotate|perspective|filter/,Kn=/paint|layout|strict|content/,Ft=(t)=>!!t&&t!=="none",po;function Nt(t){let e=Y(t)?K(t):t;return Ft(e.transform)||Ft(e.translate)||Ft(e.scale)||Ft(e.rotate)||Ft(e.perspective)||!_e()&&(Ft(e.backdropFilter)||Ft(e.filter))||Yn.test(e.willChange||"")||Kn.test(e.contain||"")}function Vi(t){let e=ft(t);while(dt(e)&&!qt(e)){if(Nt(e))return e;else if(ie(e))return null;e=ft(e)}return null}function _e(){if(po==null)po=typeof CSS<"u"&&CSS.supports&&CSS.supports("-webkit-backdrop-filter","none");return po}function qt(t){return/^(html|body|#document)$/.test(Mt(t))}function K(t){return B(t).getComputedStyle(t)}function ne(t){if(Y(t))return{scrollLeft:t.scrollLeft,scrollTop:t.scrollTop};return{scrollLeft:t.scrollX,scrollTop:t.scrollY}}function ft(t){if(Mt(t)==="html")return t;let e=t.assignedSlot||t.parentNode||qi(t)&&t.host||nt(t);return qi(e)?e.host:e}function Wi(t){let e=ft(t);if(qt(e))return(t.ownerDocument||t).body;if(dt(e)&&oe(e))return e;return Wi(e)}function ct(t,e,o){var i;if(e===void 0)e=[];if(o===void 0)o=!0;let n=Wi(t),r=n===((i=t.ownerDocument)==null?void 0:i.body),a=B(n);if(r){let s=Pe(a);return e.concat(a,a.visualViewport||[],oe(n)?n:[],s&&o?ct(s):[])}else return e.concat(n,ct(n,[],o))}function Pe(t){return t.parent&&Object.getPrototypeOf(t.parent)?t.frameElement:null}function Yi(t){let e=K(t),o=parseFloat(e.width)||0,i=parseFloat(e.height)||0,n=dt(t),r=n?t.offsetWidth:o,a=n?t.offsetHeight:i,s=te(o)!==r||te(i)!==a;if(s)o=r,i=a;return{width:o,height:i,$:s}}function go(t){return!Y(t)?t.contextElement:t}function Ut(t){let e=go(t);if(!dt(e))return ot(1);let o=e.getBoundingClientRect(),{width:i,height:n,$:r}=Yi(e),a=(r?te(o.width):o.width)/i,s=(r?te(o.height):o.height)/n;if(!a||!Number.isFinite(a))a=1;if(!s||!Number.isFinite(s))s=1;return{x:a,y:s}}var Gn=ot(0);function Ki(t){let e=B(t);if(!_e()||!e.visualViewport)return Gn;return{x:e.visualViewport.offsetLeft,y:e.visualViewport.offsetTop}}function Qn(t,e,o){if(e===void 0)e=!1;return!!o&&e&&o===B(t)}function Rt(t,e,o,i){if(e===void 0)e=!1;if(o===void 0)o=!1;let n=t.getBoundingClientRect(),r=go(t),a=ot(1);if(e)if(i){if(Y(i))a=Ut(i)}else a=Ut(t);let s=Qn(r,o,i)?Ki(r):ot(0),d=(n.left+s.x)/a.x,u=(n.top+s.y)/a.y,c=n.width/a.x,h=n.height/a.y;if(r&&i){let p=B(r),f=Y(i)?B(i):i,g=p,v=Pe(g);while(v&&f!==g){let y=Ut(v),w=v.getBoundingClientRect(),C=K(v),L=w.left+(v.clientLeft+parseFloat(C.paddingLeft))*y.x,E=w.top+(v.clientTop+parseFloat(C.paddingTop))*y.y;d*=y.x,u*=y.y,c*=y.x,h*=y.y,d+=L,u+=E,g=B(v),v=Pe(g)}}return Pt({width:c,height:h,x:d,y:u})}function Fe(t,e){let o=ne(t).scrollLeft;if(!e)return Rt(nt(t)).left+o;return e.left+o}function Gi(t,e){let o=t.getBoundingClientRect(),i=o.left+e.scrollLeft-Fe(t,o),n=o.top+e.scrollTop;return{x:i,y:n}}function Zn(t){let{elements:e,rect:o,offsetParent:i,strategy:n}=t,r=n==="fixed",a=nt(i),s=e?ie(e.floating):!1;if(i===a||s&&r)return o;let d={scrollLeft:0,scrollTop:0},u=ot(1),c=ot(0),h=dt(i);if(h||!r){if(Mt(i)!=="body"||oe(a))d=ne(i);if(h){let f=Rt(i);u=Ut(i),c.x=f.x+i.clientLeft,c.y=f.y+i.clientTop}}let p=a&&!h&&!r?Gi(a,d):ot(0);return{width:o.width*u.x,height:o.height*u.y,x:o.x*u.x-d.scrollLeft*u.x+c.x+p.x,y:o.y*u.y-d.scrollTop*u.y+c.y+p.y}}function Jn(t){return t.getClientRects?Array.from(t.getClientRects()):[]}function tr(t){let e=ne(t),o=t.ownerDocument.body,i=X(t.scrollWidth,t.clientWidth,o.scrollWidth,o.clientWidth),n=X(t.scrollHeight,t.clientHeight,o.scrollHeight,o.clientHeight),r=-e.scrollLeft+Fe(t),a=-e.scrollTop;if(K(o).direction==="rtl")r+=X(t.clientWidth,o.clientWidth)-i;return{width:i,height:n,x:r,y:a}}var er=25;function or(t,e,o){if(o===void 0)o="viewport";let i=o==="layoutViewport",n=B(t),r=nt(t),a=n.visualViewport,{clientWidth:s,clientHeight:d}=r,u=0,c=0;if(a){let p=!_e()||e==="fixed";if(i){if(!p)u=-a.offsetLeft,c=-a.offsetTop}else if(s=a.width,d=a.height,p)u=a.offsetLeft,c=a.offsetTop}if(Fe(r)<=0){let p=r.ownerDocument,f=p.body,g=getComputedStyle(f),v=p.compatMode==="CSS1Compat"?parseFloat(g.marginLeft)+parseFloat(g.marginRight)||0:0,y=Math.abs(r.clientWidth-f.clientWidth-v),w=getComputedStyle(r).scrollbarGutter==="stable both-edges"?y/2:y;if(w<=er)s-=w}return{width:s,height:d,x:u,y:c}}function ir(t,e){let o=Rt(t,!0,e==="fixed"),i=o.top+t.clientTop,n=o.left+t.clientLeft,r=Ut(t),a=t.clientWidth*r.x,s=t.clientHeight*r.y,d=n*r.x,u=i*r.y;return{width:a,height:s,x:d,y:u}}function ji(t,e,o){let i;if(e==="viewport"||e==="layoutViewport")i=or(t,o,e);else if(e==="document")i=tr(nt(t));else if(Y(e))i=ir(e,o);else{let n=Ki(t);i={x:e.x-n.x,y:e.y-n.y,width:e.width,height:e.height}}return Pt(i)}function nr(t,e){let o=e.get(t);if(o)return o;let i=ct(t,[],!1).filter((s)=>Y(s)&&Mt(s)!=="body"),n=null,r=K(t).position==="fixed",a=r?ft(t):t;while(Y(a)&&!qt(a)){let s=K(a),d=Nt(a),u=n?n.position:r?"fixed":"";if(!d&&(u==="fixed"||u==="absolute"&&s.position==="static"))i=i.filter((h)=>h!==a);else n=s;a=ft(a)}return e.set(t,i),i}function rr(t){let{element:e,boundary:o,rootBoundary:i,strategy:n}=t,a=[...o==="clippingAncestors"?ie(e)?[]:nr(e,this._c):[].concat(o),i],s=ji(e,a[0],n),{top:d,right:u,bottom:c,left:h}=s;for(let p=1;p<a.length;p++){let f=ji(e,a[p],n);d=X(f.top,d),u=et(f.right,u),c=et(f.bottom,c),h=X(f.left,h)}return{width:u-h,height:c-d,x:h,y:d}}function ar(t){let{width:e,height:o}=Yi(t);return{width:e,height:o}}function sr(t,e,o){let i=dt(e),n=nt(e),r=o==="fixed",a=Rt(t,!0,r,e),s={scrollLeft:0,scrollTop:0},d=ot(0);if(i||!r){if(Mt(e)!=="body"||oe(n))s=ne(e);if(i){let p=Rt(e,!0,r,e);d.x=p.x+e.clientLeft,d.y=p.y+e.clientTop}}if(!i&&n)d.x=Fe(n);let u=n&&!i&&!r?Gi(n,s):ot(0),c=a.left+s.scrollLeft-d.x-u.x,h=a.top+s.scrollTop-d.y-u.y;return{x:c,y:h,width:a.width,height:a.height}}function fo(t){return K(t).position==="static"}function Xi(t,e){if(!dt(t)||K(t).position==="fixed")return null;if(e)return e(t);let o=t.offsetParent;if(nt(t)===o)o=o.ownerDocument.body;return o}function Qi(t,e){let o=B(t);if(ie(t))return o;if(!dt(t)){let n=ft(t);while(n&&!qt(n)){if(Y(n)&&!fo(n))return n;n=ft(n)}return o}let i=Xi(t,e);while(i&&Hi(i)&&fo(i))i=Xi(i,e);if(i&&qt(i)&&fo(i)&&!Nt(i))return o;return i||Vi(t)||o}var lr=async function(t){let e=this.getOffsetParent||Qi,o=this.getDimensions,i=await o(t.floating);return{reference:sr(t.reference,await e(t.floating),t.strategy),floating:{x:0,y:0,width:i.width,height:i.height}}};function cr(t){return K(t).direction==="rtl"}var re={convertOffsetParentRelativeRectToViewportRelativeRect:Zn,getDocumentElement:nt,getClippingRect:rr,getOffsetParent:Qi,getElementRects:lr,getClientRects:Jn,getDimensions:ar,getScale:Ut,isElement:Y,isRTL:cr};function Zi(t,e){return t.x===e.x&&t.y===e.y&&t.width===e.width&&t.height===e.height}function dr(t,e,o){let i=null,n,r=nt(t);function a(){var c;clearTimeout(n),(c=i)==null||c.disconnect(),i=null}function s(c,h){if(c===void 0)c=!1;if(h===void 0)h=1;a();let p=t.getBoundingClientRect(),{left:f,top:g,width:v,height:y}=p;if(!c)e();if(!v||!y)return;let w=ee(g),C=ee(r.clientWidth-(f+v)),L=ee(r.clientHeight-(g+y)),E=ee(f),k={rootMargin:-w+"px "+-C+"px "+-L+"px "+-E+"px",threshold:X(0,et(1,h))||1},q=!0;function H(G){let O=G[0].intersectionRatio;if(!Zi(p,t.getBoundingClientRect()))return s();if(O!==h){if(!q)return s();if(!O)n=setTimeout(()=>{s(!1,0.0000001)},1000);else s(!1,O)}q=!1}try{i=new IntersectionObserver(H,{...k,root:r.ownerDocument})}catch(G){i=new IntersectionObserver(H,k)}i.observe(t)}let d=B(t),u=()=>s(o);return d.addEventListener("resize",u),s(!0),()=>{d.removeEventListener("resize",u),a()}}function Me(t,e,o,i){if(i===void 0)i={};let{ancestorScroll:n=!0,ancestorResize:r=!0,elementResize:a=typeof ResizeObserver==="function",layoutShift:s=typeof IntersectionObserver==="function",animationFrame:d=!1}=i,u=go(t),c=n||r?[...u?ct(u):[],...e?ct(e):[]]:[];c.forEach((w)=>{n&&w.addEventListener("scroll",o),r&&w.addEventListener("resize",o)});let h=u&&s?dr(u,o,r):null,p=-1,f=null;if(a){if(f=new ResizeObserver((w)=>{let[C]=w;if(C&&C.target===u&&f&&e)f.unobserve(e),cancelAnimationFrame(p),p=requestAnimationFrame(()=>{var L;(L=f)==null||L.observe(e)});o()}),u&&!d)f.observe(u);if(e)f.observe(e)}let g,v=d?Rt(t):null;if(d)y();function y(){let w=Rt(t);if(v&&!Zi(v,w))o();v=w,g=requestAnimationFrame(y)}return o(),()=>{var w;if(c.forEach((C)=>{n&&C.removeEventListener("scroll",o),r&&C.removeEventListener("resize",o)}),h==null||h(),(w=f)==null||w.disconnect(),f=null,d)cancelAnimationFrame(g)}}var Re=Di;var Oe=Bi,Te=Ii,vo=Ni;var Ji=Ti;var Ie=(t,e,o)=>{let i=new Map,n=o!=null?o:{},r={...re,...n.platform,_c:i};return Oi(t,e,{...n,platform:r})};/*! Copyright 2026 Fonticons, Inc. - https://webawesome.com/license */var wo=new Set,I=class extends _{constructor(){super(...arguments);this.submenuCleanups=new Map,this.localize=new tt(this),this.userTypedQuery="",this.openSubmenuStack=[],this.open=!1,this.size="m",this.placement="bottom-start",this.distance=0,this.skidding=0,this.handleDocumentKeyDown=async(t)=>{let e=this.localize.dir()==="rtl";if(t.key==="Escape"&&this.open&&Zt(this)){let c=this.getTrigger();t.preventDefault(),t.stopPropagation(),this.open=!1,c?.focus({preventScroll:!0});return}let o=[...co()].find((c)=>c.localName==="wa-dropdown-item"),i=o?.localName==="wa-dropdown-item",n=this.getCurrentSubmenuItem(),r=!!n,a,s,d;if(r)a=this.getSubmenuItems(n),s=a.find((c)=>c.active||c===o),d=s?a.indexOf(s):-1;else a=this.getItems(),s=a.find((c)=>c.active||c===o),d=s?a.indexOf(s):-1;let u;if(t.key==="ArrowUp")if(t.preventDefault(),t.stopPropagation(),d>0)u=a[d-1];else u=a[a.length-1];if(t.key==="ArrowDown")if(t.preventDefault(),t.stopPropagation(),d!==-1&&d<a.length-1)u=a[d+1];else u=a[0];if(t.key===(e?"ArrowLeft":"ArrowRight")&&i&&s){if(s.hasSubmenu){t.preventDefault(),t.stopPropagation(),s.submenuOpen=!0,this.addToSubmenuStack(s),setTimeout(()=>{let c=this.getSubmenuItems(s);if(c.length>0)c.forEach((h,p)=>h.active=p===0),c[0].focus({preventScroll:!0})},0);return}}if(t.key===(e?"ArrowRight":"ArrowLeft")&&r){t.preventDefault(),t.stopPropagation();let c=this.removeFromSubmenuStack();if(c)c.submenuOpen=!1,setTimeout(()=>{c.focus({preventScroll:!0}),c.active=!0,(c.slot==="submenu"?this.getSubmenuItems(c.parentElement):this.getItems()).forEach((p)=>{if(p!==c)p.active=!1})},0);return}if(t.key==="Home"||t.key==="End")t.preventDefault(),t.stopPropagation(),u=t.key==="Home"?a[0]:a[a.length-1];if(t.key==="Tab")await this.hideMenu();if(t.key.length===1&&!(t.metaKey||t.ctrlKey||t.altKey)&&!(t.key===" "&&this.userTypedQuery===""))clearTimeout(this.userTypedTimeout),this.userTypedTimeout=setTimeout(()=>{this.userTypedQuery=""},1000),this.userTypedQuery+=t.key,a.some((c)=>{let h=(c.textContent||"").trim().toLowerCase(),p=this.userTypedQuery.trim().toLowerCase();if(h.startsWith(p))return u=c,!0;return!1});if(u){t.preventDefault(),t.stopPropagation(),a.forEach((c)=>c.active=c===u),u.focus({preventScroll:!0}),u.scrollIntoView({block:"nearest"});return}if((t.key==="Enter"||t.key===" "&&this.userTypedQuery==="")&&i&&s)if(t.preventDefault(),t.stopPropagation(),s.hasSubmenu)s.submenuOpen=!0,this.addToSubmenuStack(s),setTimeout(()=>{let c=this.getSubmenuItems(s);if(c.length>0)c.forEach((h,p)=>h.active=p===0),c[0].focus({preventScroll:!0})},0);else this.makeSelection(s,t)},this.handleDocumentPointerDown=(t)=>{if(!t.composedPath().some((i)=>{if(i instanceof HTMLElement)return i===this||i.closest('wa-dropdown, [part="submenu"]');return!1}))this.open=!1},this.handleGlobalMouseMove=(t)=>{let e=this.getCurrentSubmenuItem();if(!e?.submenuOpen||!e.submenuElement)return;let o=e.submenuElement.getBoundingClientRect(),i=this.localize.dir()==="rtl",n=i?o.right:o.left,r=i?Math.max(t.clientX,n):Math.min(t.clientX,n),a=Math.max(o.top,Math.min(t.clientY,o.bottom));e.submenuElement.style.setProperty("--safe-triangle-cursor-x",`${r}px`),e.submenuElement.style.setProperty("--safe-triangle-cursor-y",`${a}px`);let s=t.composedPath(),d=e.matches(":hover"),u=Boolean(e.submenuElement?.matches(":hover")),c=d||!!s.find((p)=>p===e),h=u||!!s.find((p)=>p instanceof HTMLElement&&p.closest('[part="submenu"]')===e.submenuElement);if(!c&&!h)setTimeout(()=>{if(!d&&!u)e.submenuOpen=!1},100)}}handleSizeChange(){It(this.localName,this.size)}disconnectedCallback(){super.disconnectedCallback(),clearInterval(this.userTypedTimeout),this.closeAllSubmenus(),this.submenuCleanups.forEach((t)=>t()),this.submenuCleanups.clear(),document.removeEventListener("mousemove",this.handleGlobalMouseMove),document.removeEventListener("keydown",this.handleDocumentKeyDown),document.removeEventListener("pointerdown",this.handleDocumentPointerDown),Bt(this)}firstUpdated(t){super.firstUpdated(t),this.syncAriaAttributes()}async updated(t){if(t.has("open")){let e=t.get("open");if(e===this.open)return;if(e===void 0&&this.open===!1)return;if(this.customStates.set("open",this.open),this.open)await this.showMenu();else this.closeAllSubmenus(),await this.hideMenu()}if(t.has("size"))this.syncItemSizes()}getItems(t=!1){let e=(this.defaultSlot?.assignedElements({flatten:!0})??[]).filter((o)=>o.localName==="wa-dropdown-item");return t?e:e.filter((o)=>!o.disabled)}getSubmenuItems(t,e=!1){let o=t.shadowRoot?.querySelector('slot[name="submenu"]')||t.querySelector('slot[name="submenu"]');if(!o)return[];let i=o.assignedElements({flatten:!0}).filter((n)=>n.localName==="wa-dropdown-item");return e?i:i.filter((n)=>!n.disabled)}syncItemSizes(){(this.defaultSlot?.assignedElements({flatten:!0})??[]).filter((e)=>e.localName==="wa-dropdown-item").forEach((e)=>e.size=this.size)}addToSubmenuStack(t){let e=this.openSubmenuStack.indexOf(t);if(e!==-1)this.openSubmenuStack=this.openSubmenuStack.slice(0,e+1);else this.openSubmenuStack.push(t)}removeFromSubmenuStack(){return this.openSubmenuStack.pop()}getCurrentSubmenuItem(){return this.openSubmenuStack.length>0?this.openSubmenuStack[this.openSubmenuStack.length-1]:void 0}closeAllSubmenus(){this.getItems(!0).forEach((e)=>{e.submenuOpen=!1}),this.openSubmenuStack=[]}closeSiblingSubmenus(t){let e=t.closest('wa-dropdown-item:not([slot="submenu"])'),o;if(e)o=this.getSubmenuItems(e,!0);else o=this.getItems(!0);if(o.forEach((i)=>{if(i!==t&&i.submenuOpen)i.submenuOpen=!1}),!this.openSubmenuStack.includes(t))this.openSubmenuStack.push(t)}getTrigger(){return this.querySelector('[slot="trigger"]')}async showMenu(){if(!this.getTrigger()||!this.popup||!this.menu)return;let e=new Ce;if(this.dispatchEvent(e),e.defaultPrevented){this.open=!1;return}if(this.popup.active)return;wo.forEach((i)=>i.open=!1),this.popup.active=!0,this.open=!0,wo.add(this),Ae(this),this.syncAriaAttributes(),document.addEventListener("keydown",this.handleDocumentKeyDown),document.addEventListener("pointerdown",this.handleDocumentPointerDown),document.addEventListener("mousemove",this.handleGlobalMouseMove),this.menu.classList.remove("hide"),await j(this.menu,"show");let o=this.getItems();if(o.length>0)o.forEach((i,n)=>i.active=n===0),o[0].focus({preventScroll:!0});this.dispatchEvent(new Se)}async hideMenu(){if(!this.popup||!this.menu)return;let t=new xe({source:this});if(this.dispatchEvent(t),t.defaultPrevented){this.open=!0;return}this.open=!1,wo.delete(this),Bt(this),this.syncAriaAttributes(),document.removeEventListener("keydown",this.handleDocumentKeyDown),document.removeEventListener("pointerdown",this.handleDocumentPointerDown),document.removeEventListener("mousemove",this.handleGlobalMouseMove),this.menu.classList.remove("show"),await j(this.menu,"hide"),this.popup.active=this.open,this.dispatchEvent(new Le)}handleMenuClick(t){let e=t.target.closest("wa-dropdown-item");if(!e||e.disabled)return;if(e.hasSubmenu){if(!e.submenuOpen)this.closeSiblingSubmenus(e),this.addToSubmenuStack(e),e.submenuOpen=!0;t.stopPropagation();return}this.makeSelection(e,t)}async handleMenuSlotChange(){let t=this.getItems(!0);await Promise.all(t.map((i)=>i.updateComplete)),this.syncItemSizes();let e=t.some((i)=>i.type==="checkbox"),o=t.some((i)=>i.hasSubmenu);t.forEach((i,n)=>{i.setAttribute("aria-posinset",String(n+1)),i.setAttribute("aria-setsize",String(t.length)),i.active=n===0,i.checkboxAdjacent=e,i.submenuAdjacent=o})}handleTriggerClick(){this.open=!this.open}handleSubmenuOpening(t){let e=t.detail.item;this.closeSiblingSubmenus(e),this.addToSubmenuStack(e),this.setupSubmenuPosition(e),this.processSubmenuItems(e)}setupSubmenuPosition(t){if(!t.submenuElement)return;this.cleanupSubmenuPosition(t);let e=Me(t,t.submenuElement,()=>{this.positionSubmenu(t),this.updateSafeTriangleCoordinates(t)});this.submenuCleanups.set(t,e);let o=t.submenuElement.querySelector('slot[name="submenu"]');if(o)o.removeEventListener("slotchange",I.handleSubmenuSlotChange),o.addEventListener("slotchange",I.handleSubmenuSlotChange),I.handleSubmenuSlotChange({target:o})}static handleSubmenuSlotChange(t){let e=t.target;if(!e)return;let o=e.assignedElements().filter((r)=>r.localName==="wa-dropdown-item");if(o.length===0)return;let i=o.some((r)=>r.hasSubmenu),n=o.some((r)=>r.type==="checkbox");o.forEach((r)=>{r.submenuAdjacent=i,r.checkboxAdjacent=n})}processSubmenuItems(t){if(!t.submenuElement)return;let e=this.getSubmenuItems(t,!0),o=e.some((i)=>i.hasSubmenu);e.forEach((i)=>{i.submenuAdjacent=o})}cleanupSubmenuPosition(t){let e=this.submenuCleanups.get(t);if(e)e(),this.submenuCleanups.delete(t)}positionSubmenu(t){if(!t.submenuElement)return;let o=this.localize.dir()==="rtl"?"left-start":"right-start";Ie(t,t.submenuElement,{placement:o,middleware:[Re({mainAxis:0,crossAxis:-5}),Te({fallbackStrategy:"bestFit"}),Oe({padding:8,crossAxis:!0})]}).then(({x:i,y:n,placement:r})=>{t.submenuElement.setAttribute("data-placement",r),Object.assign(t.submenuElement.style,{left:`${i}px`,top:`${n}px`})})}updateSafeTriangleCoordinates(t){if(!t.submenuElement||!t.submenuOpen)return;if(document.activeElement?.matches(":focus-visible")){t.submenuElement.style.setProperty("--safe-triangle-visible","none");return}t.submenuElement.style.setProperty("--safe-triangle-visible","block");let o=t.submenuElement.getBoundingClientRect(),i=this.localize.dir()==="rtl";t.submenuElement.style.setProperty("--safe-triangle-submenu-start-x",`${i?o.right:o.left}px`),t.submenuElement.style.setProperty("--safe-triangle-submenu-start-y",`${o.top}px`),t.submenuElement.style.setProperty("--safe-triangle-submenu-end-x",`${i?o.right:o.left}px`),t.submenuElement.style.setProperty("--safe-triangle-submenu-end-y",`${o.bottom}px`)}makeSelection(t,e){let o=this.getTrigger();if(t.disabled)return;if(t.type==="checkbox")t.checked=!t.checked;let i=new Li({item:t});if(this.dispatchEvent(i),!i.defaultPrevented)t.navigate(e),this.open=!1,o?.focus({preventScroll:!0})}async syncAriaAttributes(){let t=this.getTrigger(),e;if(!t)return;if(t.localName==="wa-button")await customElements.whenDefined("wa-button"),await t.updateComplete,e=t.shadowRoot.querySelector('[part~="base"]');else e=t;if(!e.hasAttribute("id"))e.setAttribute("id",$i("wa-dropdown-trigger-"));e.setAttribute("aria-haspopup","menu"),e.setAttribute("aria-expanded",this.open?"true":"false"),this.menu?.setAttribute("aria-expanded","false")}render(){let t=this.didSSR&&!this.hasUpdated?this.open:this.popup?.active;return A`
      <wa-popup
        placement=${this.placement}
        distance=${this.distance}
        skidding=${this.skidding}
        ?active=${t}
        flip
        flip-fallback-strategy="best-fit"
        shift
        shift-padding="10"
        auto-size="vertical"
        auto-size-padding="10"
      >
        <slot
          name="trigger"
          slot="anchor"
          @click=${this.handleTriggerClick}
          @slotchange=${this.syncAriaAttributes}
        ></slot>
        <div
          id="menu"
          part="menu"
          role="menu"
          tabindex="-1"
          aria-orientation="vertical"
          @click=${this.handleMenuClick}
          @submenu-opening=${this.handleSubmenuOpening}
        >
          <slot @slotchange=${this.handleMenuSlotChange}></slot>
        </div>
      </wa-popup>
    `}};I.css=[fe,Si];l([D("slot:not([name])")],I.prototype,"defaultSlot",2);l([D("#menu")],I.prototype,"menu",2);l([D("wa-popup")],I.prototype,"popup",2);l([m({type:Boolean,reflect:!0})],I.prototype,"open",2);l([m({reflect:!0})],I.prototype,"size",2);l([T("size")],I.prototype,"handleSizeChange",1);l([m({reflect:!0})],I.prototype,"placement",2);l([m({type:Number})],I.prototype,"distance",2);l([m({type:Number})],I.prototype,"skidding",2);I=l([F("wa-dropdown")],I);/*! Copyright 2026 Fonticons, Inc. - https://webawesome.com/license */var tn=S`
  :host {
    display: flex;
    position: relative;
    align-items: center;
    padding: 0.5em 1em;
    border-radius: var(--wa-border-radius-s);
    isolation: isolate;
    color: var(--wa-color-text-normal);
    line-height: var(--wa-line-height-condensed);
    cursor: pointer;
    transition:
      var(--wa-transition-fast) background-color var(--wa-transition-easing),
      var(--wa-transition-fast) color var(--wa-transition-easing);
  }

  @media (hover: hover) {
    :host(:hover:not(:state(disabled))) {
      background-color: var(--wa-color-neutral-fill-normal);
    }
  }

  :host(:state(submenu-open)) {
    background-color: var(--wa-color-neutral-fill-normal);
  }

  :host(:focus-visible) {
    z-index: 1;
    outline: var(--wa-focus-ring);
    background-color: var(--wa-color-neutral-fill-normal);
  }

  :host(:state(disabled)),
  :host([disabled]) {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* Danger variant */
  :host([variant='danger']),
  :host([variant='danger']) #details {
    color: var(--wa-color-danger-on-quiet);
  }

  @media (hover: hover) {
    :host([variant='danger']:hover) {
      background-color: var(--wa-color-danger-fill-normal);
      color: var(--wa-color-danger-on-normal);
    }
  }

  :host([variant='danger']:state(submenu-open)),
  :host([variant='danger']:focus-visible) {
    background-color: var(--wa-color-danger-fill-normal);
    color: var(--wa-color-danger-on-normal);
  }

  :host([checkbox-adjacent]) {
    padding-inline-start: 2em;
  }

  /* Only add padding when item actually has a submenu */
  :host([submenu-adjacent]:not(:state(has-submenu))) #details {
    padding-inline-end: 0;
  }

  :host(:state(has-submenu)[submenu-adjacent]) #details {
    padding-inline-end: 1.75em;
  }

  /* The link only exists to be clicked programmatically. */
  #link {
    display: none;
  }

  #check {
    visibility: hidden;
    margin-inline-start: -1.5em;
    margin-inline-end: 0.5em;
    font-size: var(--wa-font-size-smaller);
  }

  :host(:state(checked)) #check {
    visibility: visible;
  }

  #icon ::slotted(*) {
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    margin-inline-end: 0.75em !important;
    font-size: var(--wa-font-size-smaller);
  }

  #label {
    flex: 1 1 auto;
    min-width: 0;
  }

  #details {
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    justify-content: end;
    color: var(--wa-color-text-quiet);
    font-size: var(--wa-font-size-smaller) !important;
  }

  #details ::slotted(*) {
    margin-inline-start: 2em !important;
  }

  /* Submenu indicator icon */
  #submenu-indicator {
    position: absolute;
    inset-inline-end: 1em;
    color: var(--wa-color-neutral-on-quiet);
    font-size: var(--wa-font-size-smaller);
  }

  /* Flip chevron icon when RTL */
  :host(:dir(rtl)) #submenu-indicator {
    transform: scaleX(-1);
  }

  /* Submenu styles */
  #submenu {
    display: flex;
    z-index: 10;
    position: absolute;
    top: 0;
    left: 0;
    flex-direction: column;
    width: max-content;
    margin: 0;
    padding: 0.25em;
    border: var(--wa-border-style) var(--wa-border-width-s) var(--wa-color-surface-border);
    border-radius: var(--wa-border-radius-m);
    background-color: var(--wa-color-surface-raised);
    box-shadow: var(--wa-shadow-m);
    color: var(--wa-color-text-normal);
    text-align: start;
    user-select: none;

    /* Override default popover styles */
    &[popover] {
      margin: 0;
      inset: auto;
      padding: 0.25em;
      overflow: visible;
      border-radius: var(--wa-border-radius-m);
    }

    &.show {
      animation: submenu-show var(--show-duration, var(--wa-transition-fast)) ease;
    }

    &.hide {
      animation: submenu-show var(--show-duration, var(--wa-transition-fast)) ease reverse;
    }

    /* Submenu placement transform origins */
    &[data-placement^='top'] {
      transform-origin: bottom;
    }

    &[data-placement^='bottom'] {
      transform-origin: top;
    }

    &[data-placement^='left'] {
      transform-origin: right;
    }

    &[data-placement^='right'] {
      transform-origin: left;
    }

    &[data-placement='left-start'] {
      transform-origin: right top;
    }

    &[data-placement='left-end'] {
      transform-origin: right bottom;
    }

    &[data-placement='right-start'] {
      transform-origin: left top;
    }

    &[data-placement='right-end'] {
      transform-origin: left bottom;
    }

    /* Safe triangle styling */
    &::before {
      display: none;
      z-index: 9;
      position: fixed;
      top: 0;
      right: 0;
      bottom: 0;
      left: 0;
      background-color: transparent;
      content: '';
      clip-path: polygon(
        var(--safe-triangle-cursor-x, 0) var(--safe-triangle-cursor-y, 0),
        var(--safe-triangle-submenu-start-x, 0) var(--safe-triangle-submenu-start-y, 0),
        var(--safe-triangle-submenu-end-x, 0) var(--safe-triangle-submenu-end-y, 0)
      );
      pointer-events: auto; /* Enable mouse events on the triangle */
    }

    &[data-visible]::before {
      display: block;
    }
  }

  ::slotted(wa-dropdown-item) {
    font-size: inherit;
  }

  ::slotted(wa-divider) {
    --spacing: 0.25em;
  }

  @keyframes submenu-show {
    from {
      scale: 0.9;
      opacity: 0;
    }
    to {
      scale: 1;
      opacity: 1;
    }
  }
`;/*! Copyright 2026 Fonticons, Inc. - https://webawesome.com/license */var z=class extends _{constructor(){super(...arguments);this.hasSlotController=new ht(this,"[default]","start","end"),this.active=!1,this.variant="default",this.size="m",this.checkboxAdjacent=!1,this.submenuAdjacent=!1,this.type="normal",this.checked=!1,this.disabled=!1,this.submenuOpen=!1,this.hasSubmenu=!1,this.handleSlotChange=()=>{if(this.hasSubmenu=this.hasSlotController.test("submenu"),this.updateHasSubmenuState(),this.hasSubmenu)this.setAttribute("aria-haspopup","menu"),this.setAttribute("aria-expanded",this.submenuOpen?"true":"false");else this.removeAttribute("aria-haspopup"),this.removeAttribute("aria-expanded")},this.handleHostClick=(t)=>{if(this.disabled)t.preventDefault(),t.stopImmediatePropagation()},this.handleClick=(t)=>{if(this.disabled)t.preventDefault(),t.stopImmediatePropagation()},this.handlePointerEnter=(t)=>{if(t.pointerType==="mouse"&&this.hasSubmenu&&!this.disabled)this.notifyParentOfOpening(),this.submenuOpen=!0}}handleSizeChange(){It(this.localName,this.size)}connectedCallback(){super.connectedCallback(),this.addEventListener?.("click",this.handleHostClick),this.addEventListener?.("pointerenter",this.handlePointerEnter),this.shadowRoot?.addEventListener?.("click",this.handleClick,{capture:!0}),this.shadowRoot?.addEventListener?.("slotchange",this.handleSlotChange)}disconnectedCallback(){super.disconnectedCallback(),this.closeSubmenu(),this.removeEventListener?.("click",this.handleHostClick),this.removeEventListener?.("pointerenter",this.handlePointerEnter),this.shadowRoot?.removeEventListener?.("click",this.handleClick,{capture:!0}),this.shadowRoot?.removeEventListener?.("slotchange",this.handleSlotChange)}firstUpdated(t){super.firstUpdated(t),this.setAttribute("tabindex","-1"),this.hasSubmenu=this.hasSlotController.test("submenu"),this.updateHasSubmenuState()}updated(t){if(t.has("active"))this.setAttribute("tabindex",this.active?"0":"-1"),this.customStates.set("active",this.active);if(t.has("checked")){if(this.type==="checkbox")this.setAttribute("aria-checked",this.checked?"true":"false");else this.removeAttribute("aria-checked");this.customStates.set("checked",this.checked)}if(t.has("disabled"))this.setAttribute("aria-disabled",this.disabled?"true":"false"),this.customStates.set("disabled",this.disabled);if(t.has("type"))if(this.type==="checkbox")this.setAttribute("role","menuitemcheckbox"),this.setAttribute("aria-checked",this.checked?"true":"false");else this.setAttribute("role","menuitem"),this.removeAttribute("aria-checked");if(t.has("href")||t.has("hasSubmenu"))this.customStates.set("link",this.isLink());if(t.has("submenuOpen"))if(this.customStates.set("submenu-open",this.submenuOpen),this.submenuOpen)this.openSubmenu();else this.closeSubmenu()}updateHasSubmenuState(){this.customStates.set("has-submenu",this.hasSubmenu)}async openSubmenu(){let t=this.submenuElement;if(!this.hasSubmenu||!t||!this.isConnected)return;this.notifyParentOfOpening(),t.showPopover?.(),t.hidden=!1,t.setAttribute("data-visible",""),this.submenuOpen=!0,this.setAttribute("aria-expanded","true"),await j(t,"show"),setTimeout(()=>{let e=this.getSubmenuItems();if(e.length>0)e.forEach((o,i)=>o.active=i===0),e[0].focus({preventScroll:!0})},0)}notifyParentOfOpening(){let t=new CustomEvent("submenu-opening",{bubbles:!0,composed:!0,detail:{item:this}});this.dispatchEvent(t);let e=this.parentElement;if(e)[...e.children].filter((i)=>i!==this&&i.localName==="wa-dropdown-item"&&i.getAttribute("slot")===this.getAttribute("slot")&&i.submenuOpen).forEach((i)=>{i.submenuOpen=!1})}async closeSubmenu(){let t=this.submenuElement;if(!this.hasSubmenu||!t)return;if(this.submenuOpen=!1,this.setAttribute("aria-expanded","false"),!t.hidden){if(await j(t,"hide"),t?.isConnected)t.hidden=!0,t.removeAttribute("data-visible"),t.hidePopover?.()}}isLink(){return Boolean(this.href)&&!this.hasSubmenu}navigate(t){let e=this.linkElement;if(!this.isLink()||this.disabled||!e)return;e.dispatchEvent(new MouseEvent("click",{bubbles:!1,cancelable:!0,composed:!1,altKey:t?.altKey??!1,ctrlKey:t?.ctrlKey??!1,metaKey:t?.metaKey??!1,shiftKey:t?.shiftKey??!1}))}getSubmenuItems(){return[...this.children].filter((t)=>t.localName==="wa-dropdown-item"&&t.getAttribute("slot")==="submenu"&&!t.hasAttribute("disabled"))}render(){return A`
      ${this.href?A`
            <a
              id="link"
              href=${this.href}
              target=${M(this.target)}
              rel=${M(this.rel)}
              download=${M(this.download)}
              tabindex="-1"
              aria-hidden="true"
            ></a>
          `:""}
      ${this.type==="checkbox"?A`
            <wa-icon
              id="check"
              part="checkmark"
              exportparts="svg:checkmark__svg"
              library="system"
              name="check"
            ></wa-icon>
          `:""}

      <span id="icon" part="icon">
        <slot name="icon"></slot>
      </span>

      <span id="label" part="label">
        <slot></slot>
      </span>

      <span id="details" part="details">
        <slot name="details"></slot>
      </span>

      ${this.hasSubmenu?A`
            <wa-icon
              id="submenu-indicator"
              part="submenu-icon"
              exportparts="svg:submenu-icon__svg"
              library="system"
              name="chevron-right"
            ></wa-icon>
          `:""}
      ${this.hasSubmenu?A`
            <div
              id="submenu"
              part="submenu"
              popover="manual"
              role="menu"
              tabindex="-1"
              aria-orientation="vertical"
              hidden
            >
              <slot name="submenu"></slot>
            </div>
          `:""}
    `}};z.css=tn;l([D("#submenu")],z.prototype,"submenuElement",2);l([D("#link")],z.prototype,"linkElement",2);l([m({type:Boolean})],z.prototype,"active",2);l([m({reflect:!0})],z.prototype,"variant",2);l([m({reflect:!0})],z.prototype,"size",2);l([T("size")],z.prototype,"handleSizeChange",1);l([m({attribute:"checkbox-adjacent",type:Boolean,reflect:!0})],z.prototype,"checkboxAdjacent",2);l([m({attribute:"submenu-adjacent",type:Boolean,reflect:!0})],z.prototype,"submenuAdjacent",2);l([m()],z.prototype,"value",2);l([m({reflect:!0})],z.prototype,"type",2);l([m({type:Boolean})],z.prototype,"checked",2);l([m({type:Boolean,reflect:!0})],z.prototype,"disabled",2);l([m({type:Boolean,reflect:!0})],z.prototype,"submenuOpen",2);l([m({reflect:!0})],z.prototype,"href",2);l([m()],z.prototype,"target",2);l([m()],z.prototype,"rel",2);l([m()],z.prototype,"download",2);l([St()],z.prototype,"hasSubmenu",2);z=l([F("wa-dropdown-item")],z);/*! Copyright 2026 Fonticons, Inc. - https://webawesome.com/license */var en=class extends Event{constructor(){super("wa-reposition",{bubbles:!0,cancelable:!1,composed:!0})}};/*! Copyright 2026 Fonticons, Inc. - https://webawesome.com/license */var on=S`
  :host {
    --arrow-color: black;
    --arrow-size: var(--wa-tooltip-arrow-size);
    --popup-border-width: 0px;
    --show-duration: var(--wa-transition-fast);
    --hide-duration: var(--wa-transition-fast);

    /*
     * These properties are computed to account for the arrow's dimensions after being rotated 45º. The constant
     * 0.7071 is derived from sin(45) to calculate the length of the arrow after rotation.
     *
     * The diamond will be translated inward by --arrow-base-offset, the border thickness, to centralise it on
     * the inner edge of the popup border. This also means we need to increase the size of the arrow by the
     * same amount to compensate.
     *
     * A diamond shaped clipping mask is used to avoid overlap of popup content. This extends slightly inward so
     * the popup border is covered with no sub-pixel rounding artifacts. The diamond corners are mitred at 22.5º
     * to properly merge any arrow border with the popup border. The constant 1.4142 is derived from 1 + tan(22.5).
     *
     */
    --arrow-base-offset: var(--popup-border-width);
    --arrow-size-diagonal: calc((var(--arrow-size) + var(--arrow-base-offset)) * 0.7071);
    --arrow-padding-offset: calc(var(--arrow-size-diagonal) - var(--arrow-size));
    --arrow-size-div: calc(var(--arrow-size-diagonal) * 2);
    --arrow-clipping-corner: calc(var(--arrow-base-offset) * 1.4142);

    display: contents;
  }

  .popup {
    position: absolute;
    isolation: isolate;
    max-width: var(--auto-size-available-width, none);
    max-height: var(--auto-size-available-height, none);

    /* Clear UA styles for [popover] */
    :where(&) {
      inset: unset;
      padding: unset;
      margin: unset;
      width: unset;
      height: unset;
      color: unset;
      background: unset;
      border: unset;
      overflow: unset;
    }
  }

  .popup-fixed {
    position: fixed;
  }

  .popup:not(.popup-active) {
    display: none;
  }

  .arrow {
    position: absolute;
    width: var(--arrow-size-div);
    height: var(--arrow-size-div);
    background: var(--arrow-color);
    z-index: 3;
    clip-path: polygon(
      var(--arrow-clipping-corner) 100%,
      var(--arrow-base-offset) calc(100% - var(--arrow-base-offset)),
      calc(var(--arrow-base-offset) - 2px) calc(100% - var(--arrow-base-offset)),
      calc(100% - var(--arrow-base-offset)) calc(var(--arrow-base-offset) - 2px),
      calc(100% - var(--arrow-base-offset)) var(--arrow-base-offset),
      100% var(--arrow-clipping-corner),
      100% 100%
    );
    rotate: 45deg;
  }

  :host([data-current-placement|='left']) .arrow {
    rotate: -45deg;
  }

  :host([data-current-placement|='right']) .arrow {
    rotate: 135deg;
  }

  :host([data-current-placement|='bottom']) .arrow {
    rotate: 225deg;
  }

  /* Hover bridge */
  .popup-hover-bridge:not(.popup-hover-bridge-visible) {
    display: none;
  }

  .popup-hover-bridge {
    position: fixed;
    z-index: 899;
    top: 0;
    right: 0;
    bottom: 0;
    left: 0;
    clip-path: polygon(
      var(--hover-bridge-top-left-x, 0) var(--hover-bridge-top-left-y, 0),
      var(--hover-bridge-top-right-x, 0) var(--hover-bridge-top-right-y, 0),
      var(--hover-bridge-bottom-right-x, 0) var(--hover-bridge-bottom-right-y, 0),
      var(--hover-bridge-bottom-left-x, 0) var(--hover-bridge-bottom-left-y, 0)
    );
  }

  /* Built-in animations */
  .show {
    animation: show var(--show-duration) ease;
  }

  .hide {
    animation: show var(--hide-duration) ease reverse;
  }

  @keyframes show {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  .show-with-scale {
    animation: show-with-scale var(--show-duration) ease;
  }

  .hide-with-scale {
    animation: show-with-scale var(--hide-duration) ease reverse;
  }

  @keyframes show-with-scale {
    from {
      opacity: 0;
      scale: 0.8;
    }
    to {
      opacity: 1;
      scale: 1;
    }
  }
`;function nn(t){return ur(t)}function bo(t){return t.assignedSlot?t.assignedSlot:t.parentNode instanceof ShadowRoot?t.parentNode.host:t.parentNode}function ur(t){for(let e=t;e;e=bo(e))if(e instanceof Element&&getComputedStyle(e).display==="none")return null;for(let e=bo(t);e;e=bo(e)){if(!(e instanceof Element))continue;let o=getComputedStyle(e);if(o.display!=="contents"){if(o.position!=="static"||Nt(o))return e;if(e.tagName==="BODY")return e}}return null}/*! Copyright 2026 Fonticons, Inc. - https://webawesome.com/license */function rn(t){return t!==null&&typeof t==="object"&&"getBoundingClientRect"in t&&("contextElement"in t?t instanceof Element:!0)}var mr=Boolean(globalThis?.HTMLElement?.prototype.hasOwnProperty("popover")),x=class extends _{constructor(){super(...arguments);this.localize=new tt(this),this.SUPPORTS_POPOVER=!1,this.active=!1,this.placement="top",this.boundary="viewport",this.distance=0,this.skidding=0,this.arrow=!1,this.arrowPlacement="anchor",this.arrowPadding=10,this.flip=!1,this.flipFallbackPlacements="",this.flipFallbackStrategy="best-fit",this.flipPadding=0,this.shift=!1,this.shiftPadding=0,this.autoSizePadding=0,this.hoverBridge=!1,this.updateHoverBridge=()=>{if(this.hoverBridge&&this.anchorEl&&this.popup){let t=this.anchorEl.getBoundingClientRect(),e=this.popup.getBoundingClientRect(),o=this.placement.includes("top")||this.placement.includes("bottom"),i=0,n=0,r=0,a=0,s=0,d=0,u=0,c=0;if(o)if(t.top<e.top)i=t.left,n=t.bottom,r=t.right,a=t.bottom,s=e.left,d=e.top,u=e.right,c=e.top;else i=e.left,n=e.bottom,r=e.right,a=e.bottom,s=t.left,d=t.top,u=t.right,c=t.top;else if(t.left<e.left)i=t.right,n=t.top,r=e.left,a=e.top,s=t.right,d=t.bottom,u=e.left,c=e.bottom;else i=e.right,n=e.top,r=t.left,a=t.top,s=e.right,d=e.bottom,u=t.left,c=t.bottom;this.style.setProperty("--hover-bridge-top-left-x",`${i}px`),this.style.setProperty("--hover-bridge-top-left-y",`${n}px`),this.style.setProperty("--hover-bridge-top-right-x",`${r}px`),this.style.setProperty("--hover-bridge-top-right-y",`${a}px`),this.style.setProperty("--hover-bridge-bottom-left-x",`${s}px`),this.style.setProperty("--hover-bridge-bottom-left-y",`${d}px`),this.style.setProperty("--hover-bridge-bottom-right-x",`${u}px`),this.style.setProperty("--hover-bridge-bottom-right-y",`${c}px`)}}}async connectedCallback(){super.connectedCallback(),await this.updateComplete,this.SUPPORTS_POPOVER=mr,this.start()}disconnectedCallback(){super.disconnectedCallback(),this.stop()}async updated(t){if(super.updated(t),t.has("active"))if(this.active)this.start();else this.stop();if(t.has("anchor"))this.handleAnchorChange();if(this.active)await this.updateComplete,this.reposition()}async handleAnchorChange(){if(await this.stop(),this.anchor&&typeof this.anchor==="string"){let t=this.getRootNode();this.anchorEl=t.getElementById(this.anchor)}else if(this.anchor instanceof Element||rn(this.anchor))this.anchorEl=this.anchor;else this.anchorEl=this.querySelector('[slot="anchor"]');if(this.anchorEl instanceof HTMLSlotElement)this.anchorEl=this.anchorEl.assignedElements({flatten:!0})[0];if(this.anchorEl)this.start()}start(){if(!this.anchorEl||!this.active||!this.isConnected)return;this.popup?.showPopover?.(),this.cleanup=Me(this.anchorEl,this.popup,()=>{this.reposition()})}async stop(){return new Promise((t)=>{if(this.popup?.hidePopover?.(),this.cleanup)this.cleanup(),this.cleanup=void 0,this.removeAttribute("data-current-placement"),this.style.removeProperty("--auto-size-available-width"),this.style.removeProperty("--auto-size-available-height"),requestAnimationFrame(()=>t());else t()})}reposition(){if(!this.active||!this.anchorEl||!this.popup)return;let t=[Re({mainAxis:this.distance,crossAxis:this.skidding})];if(this.sync)t.push(vo({apply:({rects:i})=>{let n=this.sync==="width"||this.sync==="both",r=this.sync==="height"||this.sync==="both";this.popup.style.width=n?`${i.reference.width}px`:"",this.popup.style.height=r?`${i.reference.height}px`:""}}));else this.popup.style.width="",this.popup.style.height="";let e;if(this.SUPPORTS_POPOVER&&!rn(this.anchor)&&this.boundary==="scroll")e=ct(this.anchorEl).filter((i)=>i instanceof Element);if(this.flip)t.push(Te({boundary:this.flipBoundary||e,fallbackPlacements:this.flipFallbackPlacements,fallbackStrategy:this.flipFallbackStrategy==="best-fit"?"bestFit":"initialPlacement",padding:this.flipPadding}));if(this.shift)t.push(Oe({boundary:this.shiftBoundary||e,padding:this.shiftPadding}));if(this.autoSize)t.push(vo({boundary:this.autoSizeBoundary||e,padding:this.autoSizePadding,apply:({availableWidth:i,availableHeight:n})=>{if(this.autoSize==="vertical"||this.autoSize==="both")this.style.setProperty("--auto-size-available-height",`${n}px`);else this.style.removeProperty("--auto-size-available-height");if(this.autoSize==="horizontal"||this.autoSize==="both")this.style.setProperty("--auto-size-available-width",`${i}px`);else this.style.removeProperty("--auto-size-available-width")}}));else this.style.removeProperty("--auto-size-available-width"),this.style.removeProperty("--auto-size-available-height");if(this.arrow)t.push(Ji({element:this.arrowEl,padding:this.arrowPadding}));let o=this.SUPPORTS_POPOVER?(i)=>re.getOffsetParent(i,nn):re.getOffsetParent;Ie(this.anchorEl,this.popup,{placement:this.placement,middleware:t,strategy:this.SUPPORTS_POPOVER?"absolute":"fixed",platform:{...re,getOffsetParent:o}}).then(({x:i,y:n,middlewareData:r,placement:a})=>{let s=this.localize.dir()==="rtl",d={top:"bottom",right:"left",bottom:"top",left:"right"}[a.split("-")[0]];if(this.setAttribute("data-current-placement",a),Object.assign(this.popup.style,{left:`${i}px`,top:`${n}px`}),this.arrow){let u=r.arrow.x,c=r.arrow.y,h="",p="",f="",g="";if(this.arrowPlacement==="start"){let v=typeof u==="number"?`calc(${this.arrowPadding}px - var(--arrow-padding-offset))`:"";h=typeof c==="number"?`calc(${this.arrowPadding}px - var(--arrow-padding-offset))`:"",p=s?v:"",g=s?"":v}else if(this.arrowPlacement==="end"){let v=typeof u==="number"?`calc(${this.arrowPadding}px - var(--arrow-padding-offset))`:"";p=s?"":v,g=s?v:"",f=typeof c==="number"?`calc(${this.arrowPadding}px - var(--arrow-padding-offset))`:""}else if(this.arrowPlacement==="center")g=typeof u==="number"?"calc(50% - var(--arrow-size-diagonal))":"",h=typeof c==="number"?"calc(50% - var(--arrow-size-diagonal))":"";else g=typeof u==="number"?`${u}px`:"",h=typeof c==="number"?`${c}px`:"";Object.assign(this.arrowEl.style,{top:h,right:p,bottom:f,left:g,[d]:"calc(var(--arrow-base-offset) - var(--arrow-size-diagonal))"})}}),requestAnimationFrame(()=>this.updateHoverBridge()),this.dispatchEvent(new en)}render(){return A`
      <slot name="anchor" @slotchange=${this.handleAnchorChange}></slot>

      <span
        part="hover-bridge"
        class=${$t({"popup-hover-bridge":!0,"popup-hover-bridge-visible":this.hoverBridge&&this.active})}
      ></span>

      <div
        popover="manual"
        part="popup"
        class=${$t({popup:!0,"popup-active":this.active,"popup-fixed":!this.SUPPORTS_POPOVER,"popup-has-arrow":this.arrow})}
      >
        <slot></slot>
        ${this.arrow?A`<div part="arrow" class="arrow" role="presentation"></div>`:""}
      </div>
    `}};x.css=on;l([D(".popup")],x.prototype,"popup",2);l([D(".arrow")],x.prototype,"arrowEl",2);l([m({attribute:!1,type:Boolean})],x.prototype,"SUPPORTS_POPOVER",2);l([m()],x.prototype,"anchor",2);l([m({type:Boolean,reflect:!0})],x.prototype,"active",2);l([m({reflect:!0})],x.prototype,"placement",2);l([m()],x.prototype,"boundary",2);l([m({type:Number})],x.prototype,"distance",2);l([m({type:Number})],x.prototype,"skidding",2);l([m({type:Boolean})],x.prototype,"arrow",2);l([m({attribute:"arrow-placement"})],x.prototype,"arrowPlacement",2);l([m({attribute:"arrow-padding",type:Number})],x.prototype,"arrowPadding",2);l([m({type:Boolean})],x.prototype,"flip",2);l([m({attribute:"flip-fallback-placements",converter:{fromAttribute:(t)=>t.split(" ").map((e)=>e.trim()).filter((e)=>e!==""),toAttribute:(t)=>t.join(" ")}})],x.prototype,"flipFallbackPlacements",2);l([m({attribute:"flip-fallback-strategy"})],x.prototype,"flipFallbackStrategy",2);l([m({type:Object})],x.prototype,"flipBoundary",2);l([m({attribute:"flip-padding",type:Number})],x.prototype,"flipPadding",2);l([m({type:Boolean})],x.prototype,"shift",2);l([m({type:Object})],x.prototype,"shiftBoundary",2);l([m({attribute:"shift-padding",type:Number})],x.prototype,"shiftPadding",2);l([m({attribute:"auto-size"})],x.prototype,"autoSize",2);l([m()],x.prototype,"sync",2);l([m({type:Object})],x.prototype,"autoSizeBoundary",2);l([m({attribute:"auto-size-padding",type:Number})],x.prototype,"autoSizePadding",2);l([m({attribute:"hover-bridge",type:Boolean})],x.prototype,"hoverBridge",2);x=l([F("wa-popup")],x);/*! Copyright 2026 Fonticons, Inc. - https://webawesome.com/license *//*! Copyright 2026 Fonticons, Inc. - https://webawesome.com/license *//*! Copyright 2026 Fonticons, Inc. - https://webawesome.com/license */var an=S`
  :host {
    --color: var(--wa-color-surface-border);
    --width: var(--wa-border-width-s);
    --spacing: var(--wa-space-m);
    --label-spacing: var(--wa-space-s);
    --label-offset: 0;
  }

  :host(:not([orientation='vertical'])) {
    display: block;
    border-top: solid var(--width) var(--color);
    margin: var(--spacing) 0;
  }

  :host([orientation='vertical']) {
    display: inline-block;
    height: 100%;
    border-inline-start: solid var(--width) var(--color);
    margin: 0 var(--spacing);
    min-block-size: 1lh;
  }

  /* With a label, the host's border gives way to two lines that flank the label */
  :host([with-label]) {
    align-items: center;
    gap: var(--label-spacing);
    border: none;
  }

  :host([with-label]:not([orientation='vertical'])) {
    display: flex;
  }

  :host([with-label][orientation='vertical']) {
    display: inline-flex;
    flex-direction: column;
  }

  :host([with-label])::before,
  :host([with-label])::after {
    content: '';
    flex: 1 1 0;
  }

  :host([with-label]:not([orientation='vertical']))::before,
  :host([with-label]:not([orientation='vertical']))::after {
    min-inline-size: 1em;
    border-top: solid var(--width) var(--color);
  }

  :host([with-label][orientation='vertical'])::before,
  :host([with-label][orientation='vertical'])::after {
    min-block-size: 1lh;
    border-inline-start: solid var(--width) var(--color);
  }

  :host([with-label][label-placement='start'])::before,
  :host([with-label][label-placement='end'])::after {
    flex: 0 0 var(--label-offset);
    min-inline-size: 0;
    min-block-size: 0;
  }

  :host(:not([with-label])) .label {
    display: none;
  }

  :host([with-label]) .label {
    display: inline-flex;
    align-items: center;
    gap: var(--wa-space-2xs);
    flex: 0 1 auto;
    color: var(--wa-color-text-quiet);
    font-size: var(--wa-font-size-s);
    line-height: var(--wa-line-height-condensed);
    text-align: center;
  }
`;/*! Copyright 2026 Fonticons, Inc. - https://webawesome.com/license */var gt=class extends _{constructor(){super(...arguments);this.hasSlotController=new ht(this,"[default]"),this.orientation="horizontal",this.withLabel=!1,this.labelPlacement="center"}connectedCallback(){super.connectedCallback(),this.setAttribute("role","separator")}willUpdate(t){this.withLabel=this.hasSlotController.test("[default]","withLabel"),super.willUpdate(t)}handleVerticalChange(){this.setAttribute("aria-orientation",this.orientation)}handleSlotChange(){if(this.internals)this.internals.ariaLabel=this.textContent?.trim()||null}render(){return A`
      <div part="label" class="label">
        <slot @slotchange=${this.handleSlotChange}></slot>
      </div>
    `}};gt.css=an;l([m({reflect:!0})],gt.prototype,"orientation",2);l([m({attribute:"with-label",type:Boolean,reflect:!0})],gt.prototype,"withLabel",2);l([m({attribute:"label-placement",reflect:!0})],gt.prototype,"labelPlacement",2);l([T("orientation")],gt.prototype,"handleVerticalChange",1);gt=l([F("wa-divider")],gt);/*! Copyright 2026 Fonticons, Inc. - https://webawesome.com/license *//*! Copyright 2026 Fonticons, Inc. - https://webawesome.com/license */var sn=S`
  :host {
    --color: var(--wa-color-neutral-fill-normal);
    --sheen-color: color-mix(in oklab, var(--color), var(--wa-color-surface-raised));

    display: flex;
    position: relative;
    width: 100%;
    height: 100%;
    min-height: 1rem;
  }

  .indicator {
    flex: 1 1 auto;
    background: var(--color);
    border-radius: var(--wa-border-radius-pill);
  }

  :host([effect='sheen']) .indicator {
    background: linear-gradient(270deg, var(--sheen-color), var(--color), var(--color), var(--sheen-color));
    background-size: 400% 100%;
    animation: sheen 8s ease-in-out infinite;
  }

  :host([effect='pulse']) .indicator {
    animation: pulse 2s ease-in-out 0.5s infinite;
  }

  /* Forced colors mode */
  @media (forced-colors: active) {
    :host {
      --color: GrayText;
    }
  }

  @keyframes sheen {
    0% {
      background-position: 200% 0;
    }
    to {
      background-position: -200% 0;
    }
  }

  @keyframes pulse {
    0% {
      opacity: 1;
    }
    50% {
      opacity: 0.4;
    }
    100% {
      opacity: 1;
    }
  }
`;/*! Copyright 2026 Fonticons, Inc. - https://webawesome.com/license */var ae=class extends _{constructor(){super(...arguments);this.effect="none"}render(){return A` <div part="indicator" class="indicator"></div> `}};ae.css=sn;l([m({reflect:!0})],ae.prototype,"effect",2);ae=l([F("wa-skeleton")],ae);/*! Copyright 2026 Fonticons, Inc. - https://webawesome.com/license *//*! Copyright 2026 Fonticons, Inc. - https://webawesome.com/license */var hr={$code:"es",$name:"Español",$dir:"ltr",allTagsRemoved:"Se eliminaron todas las etiquetas",am:"AM",autosizeColumn:"Ajustar el tamaño de la columna al contenido",captions:"Subtítulos",carousel:"Carrusel",chooseDate:"Elegir fecha",chooseDecade:"Elegir década",chooseMonth:"Elegir mes",chooseTime:"Elegir hora",chooseYear:"Elegir año",clearEntry:"Borrar entrada",clearFilter:"Borrar filtro",clearSort:"Borrar orden",close:"Cerrar",closeCalendar:"Cerrar calendario",closeTimeInput:"Cerrar selector de hora",collapseRow:"Contraer fila",columnMenu:"Opciones de columna",columnMovedToPosition:(t,e,o)=>`${t} movida a la posición ${e} de ${o}`,columns:"Columnas",compactPageXOfY:(t,e)=>`${t} de ${e}`,completed:"Completado",copied:"Copiado",copy:"Copiar",createOption:(t)=>`Crear "${t}"`,currentlyPlaying:"reproduciendo actualmente",currentValue:"Valor actual",date:"Fecha",datePickerKeyboardHelp:"Use las teclas de flecha para cambiar los valores; presione Alt+Flecha abajo para abrir el calendario.",day:"Día",dayPeriod:"AM/PM",decrement:"Disminuir",deselectAllRows:"Deseleccionar todas las filas",disabled:"Deshabilitado",dropFileHere:"Drop file here or click to browse",dropFilesHere:"Drop files here or click to browse",empty:"Vacío",endDate:"Fecha de fin",enterFullscreen:"Entrar en pantalla completa",error:"Error",exitFullscreen:"Salir de pantalla completa",expandRow:"Expandir fila",filterByColumn:(t)=>`Filtrar por ${t}`,filterFrom:"Desde",filterMax:"Máx",filterMin:"Mín",filterTo:"Hasta",firstPage:"Primera página",goToSlide:(t,e)=>`Ir a la diapositiva ${t} de ${e}`,hideColumn:"Ocultar columna",hidePassword:"Ocultar contraseña",hour:"Hora",incompleteDate:"Introduzca una fecha válida.",increment:"Aumentar",jumpBackwardX:(t)=>{if(t===1)return"Retroceder 1 página";return`Retroceder ${t} páginas`},jumpForwardX:(t)=>{if(t===1)return"Avanzar 1 página";return`Avanzar ${t} páginas`},lastPage:"Última página",loading:"Cargando",locked:"Bloqueado",minute:"Minuto",month:"Mes",moreOptions:"Más opciones",mute:"Silenciar",nextDecade:"Década siguiente",nextMonth:"Mes siguiente",nextPage:"Página siguiente",nextSlide:"Siguiente diapositiva",nextVideo:"Siguiente vídeo",nextYear:"Año siguiente",noData:"No hay datos",noOptions:"No hay opciones",noResults:"No hay resultados coincidentes",notCompleted:"No completado",now:"Ahora",numCharacters:(t)=>{if(t===1)return"1 carácter";return`${t} caracteres`},numCharactersRemaining:(t)=>{if(t===1)return"1 carácter restante";return`${t} caracteres restantes`},numOptionsAvailable:(t)=>{if(t===0)return"No hay opciones disponibles";if(t===1)return"1 opción disponible";return`${t} opciones disponibles`},numOptionsSelected:(t)=>{if(t===0)return"No hay opciones seleccionadas";if(t===1)return"1 opción seleccionada";return`${t} opción seleccionada`},numRowsCopied:(t)=>t===1?"1 fila copiada":`${t} filas copiadas`,numRowsSelected:(t)=>t===1?"1 fila seleccionada":`${t} filas seleccionadas`,optionPosition:(t,e,o)=>`${t}, ${e} de ${o}`,optionsLoadError:"No se pudieron cargar las opciones",pageXOfY:(t,e)=>`Página ${t} de ${e}`,pagination:"Paginación",pause:"Pausar",pauseAnimation:"Pausar animación",pictureInPicture:"Imagen en imagen",pinLeft:"Fijar a la izquierda",pinRight:"Fijar a la derecha",play:"Reproducir",playAnimation:"Reproducir animación",playbackSpeed:"Velocidad de reproducción",playlist:"Lista de reproducción",pm:"PM",previousDecade:"Década anterior",previousMonth:"Mes anterior",previousPage:"Página anterior",previousSlide:"Diapositiva anterior",previousVideo:"Vídeo anterior",previousYear:"Año anterior",progress:"Progreso",rangeTooLong:(t)=>{if(t===1)return"Seleccione un intervalo no mayor de 1 día";return`Seleccione un intervalo no mayor de ${t} días`},rangeTooShort:(t)=>{if(t===1)return"Seleccione un intervalo de al menos 1 día";return`Seleccione un intervalo de al menos ${t} días`},readonly:"Solo lectura",remove:"Eliminar",resetColumns:"Restablecer columnas",resize:"Cambiar el tamaño",resizeColumn:"Cambiar el tamaño de la columna",rowsPerPage:"Filas por página",scrollableRegion:"Región desplazable",scrollToEnd:"Desplazarse hasta el final",scrollToStart:"Desplazarse al inicio",search:"Buscar",second:"Segundo",seek:"Buscar",seekProgress:(t,e)=>`${t} de ${e}`,selectAColorFromTheScreen:"Seleccione un color de la pantalla",selectAllRows:"Seleccionar todas las filas",selected:"Seleccionado",selectedDateLabel:(t)=>`Seleccionado: ${t}`,selectedRangeLabel:(t)=>`Intervalo seleccionado: ${t}`,selectGroup:"Seleccionar grupo",selectionCleared:"Selección borrada",selectRow:"Seleccionar fila",showingNofMRows:(t,e)=>`Mostrando ${t} de ${e} filas`,showingXtoYofZ:(t,e,o)=>`${t}–${e} de ${o}`,showPassword:"Mostrar contraseña",slideNum:(t)=>`Diapositiva ${t}`,sortAscending:"Ordenar de forma ascendente",sortColumn:"Ordenar columna",sortDescending:"Ordenar de forma descendente",startDate:"Fecha de inicio",steps:"Pasos",stepXOfY:(t,e)=>`Paso ${t} de ${e}`,tagAdded:(t)=>`Se añadió ${t}`,tagAlreadyAdded:(t)=>`${t} ya existe`,tagInputKeyboardHelp:"Pulse Retroceso o Suprimir para eliminar esta etiqueta.",tagRemoved:(t)=>`Se eliminó ${t}`,time:"Hora",timeInputKeyboardHelp:"Use las teclas de flecha para cambiar los valores; presione Alt+Flecha abajo para abrir el selector de hora.",today:"Hoy",toggleColorFormat:"Alternar formato de color",tooFewTags:(t)=>t===1?"Añada al menos 1 etiqueta":`Añada al menos ${t} etiquetas`,tooManyTags:(t)=>t===1?"Añada como máximo 1 etiqueta":`Añada como máximo ${t} etiquetas`,unmute:"Activar sonido",unpin:"Desfijar",unpinColumn:"Desfijar columna",videoPlayer:"Reproductor de vídeo",volume:"Volumen",year:"Año",zoomIn:"Acercar",zoomOut:"Alejar"};Et(hr);
