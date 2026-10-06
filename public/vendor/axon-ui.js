/*! Copyright 2026 Fonticons, Inc. - https://webawesome.com/license */var b0=()=>{return{checkValidity(o){let a=o.input,n={message:"",isValid:!0,invalidKeys:[]};if(!a)return n;let r=!0;if("checkValidity"in a)r=a.checkValidity();if(r)return n;if(n.isValid=!1,"validationMessage"in a)n.message=a.validationMessage;if(!("validity"in a))return n.invalidKeys.push("customError"),n;for(let i in a.validity){if(i==="valid")continue;let c=i;if(a.validity[c])n.invalidKeys.push(c)}return n}}};/*! Copyright 2026 Fonticons, Inc. - https://webawesome.com/license */var s2=class extends Event{constructor(){super("wa-invalid",{bubbles:!0,cancelable:!1,composed:!0})}};/*! Copyright 2026 Fonticons, Inc. - https://webawesome.com/license */var{defineProperty:i4,getOwnPropertyDescriptor:c4}=Object,h0=(o)=>{throw TypeError(o)},w=(o,a,n,r)=>{var i=r>1?void 0:r?c4(a,n):a;for(var c=o.length-1,t;c>=0;c--)if(t=o[c])i=(r?t(a,n,i):t(i))||i;if(r&&i)i4(a,n,i);return i},v0=(o,a,n)=>a.has(o)||h0("Cannot "+n),f0=(o,a,n)=>(v0(o,a,"read from private field"),n?n.call(o):a.get(o)),d0=(o,a,n)=>a.has(o)?h0("Cannot add the same private member more than once"):a instanceof WeakSet?a.add(o):a.set(o,n),p0=(o,a,n,r)=>(v0(o,a,"write to private field"),r?r.call(o,n):a.set(o,n),n);var w2=globalThis,l2=w2.ShadowRoot&&(w2.ShadyCSS===void 0||w2.ShadyCSS.nativeShadow)&&"adoptedStyleSheets"in Document.prototype&&"replace"in CSSStyleSheet.prototype,G2=Symbol(),z0=new WeakMap;class u2{constructor(o,a,n){if(this._$cssResult$=!0,n!==G2)throw Error("CSSResult is not constructable. Use `unsafeCSS` or `css` instead.");this.cssText=o,this.t=a}get styleSheet(){let o=this.o,a=this.t;if(l2&&o===void 0){let n=a!==void 0&&a.length===1;n&&(o=z0.get(a)),o===void 0&&((this.o=o=new CSSStyleSheet).replaceSync(this.cssText),n&&z0.set(a,o))}return o}toString(){return this.cssText}}var L0=(o)=>new u2(typeof o=="string"?o:o+"",void 0,G2),y=(o,...a)=>{let n=o.length===1?o[0]:a.reduce((r,i,c)=>r+((t)=>{if(t._$cssResult$===!0)return t.cssText;if(typeof t=="number")return t;throw Error("Value passed to 'css' function must be a 'css' function result: "+t+". Use 'unsafeCSS' to pass non-literal values, but take care to ensure page security.")})(i)+o[c+1],o[0]);return new u2(n,o,G2)},C0=(o,a)=>{if(l2)o.adoptedStyleSheets=a.map((n)=>n instanceof CSSStyleSheet?n:n.styleSheet);else for(let n of a){let r=document.createElement("style"),i=w2.litNonce;i!==void 0&&r.setAttribute("nonce",i),r.textContent=n.cssText,o.appendChild(r)}},K2=l2?(o)=>o:(o)=>o instanceof CSSStyleSheet?((a)=>{let n="";for(let r of a.cssRules)n+=r.cssText;return L0(n)})(o):o;var{is:t4,defineProperty:s4,getOwnPropertyDescriptor:w4,getOwnPropertyNames:l4,getOwnPropertySymbols:u4,getPrototypeOf:m4}=Object,m2=globalThis,x0=m2.trustedTypes,g4=x0?x0.emptyScript:"",b4=m2.reactiveElementPolyfillSupport,Io=(o,a)=>o,jo={toAttribute(o,a){switch(a){case Boolean:o=o?g4:null;break;case Object:case Array:o=o==null?o:JSON.stringify(o)}return o},fromAttribute(o,a){let n=o;switch(a){case Boolean:n=o!==null;break;case Number:n=o===null?null:Number(o);break;case Object:case Array:try{n=JSON.parse(o)}catch(r){n=null}}return n}},g2=(o,a)=>!t4(o,a),F0={attribute:!0,type:String,converter:jo,reflect:!1,useDefault:!1,hasChanged:g2};Symbol.metadata??=Symbol("metadata"),m2.litPropertyMetadata??=new WeakMap;class uo extends HTMLElement{static addInitializer(o){this._$Ei(),(this.l??=[]).push(o)}static get observedAttributes(){return this.finalize(),this._$Eh&&[...this._$Eh.keys()]}static createProperty(o,a=F0){if(a.state&&(a.attribute=!1),this._$Ei(),this.prototype.hasOwnProperty(o)&&((a=Object.create(a)).wrapped=!0),this.elementProperties.set(o,a),!a.noAccessor){let n=Symbol(),r=this.getPropertyDescriptor(o,n,a);r!==void 0&&s4(this.prototype,o,r)}}static getPropertyDescriptor(o,a,n){let{get:r,set:i}=w4(this.prototype,o)??{get(){return this[a]},set(c){this[a]=c}};return{get:r,set(c){let t=r?.call(this);i?.call(this,c),this.requestUpdate(o,t,n)},configurable:!0,enumerable:!0}}static getPropertyOptions(o){return this.elementProperties.get(o)??F0}static _$Ei(){if(this.hasOwnProperty(Io("elementProperties")))return;let o=m4(this);o.finalize(),o.l!==void 0&&(this.l=[...o.l]),this.elementProperties=new Map(o.elementProperties)}static finalize(){if(this.hasOwnProperty(Io("finalized")))return;if(this.finalized=!0,this._$Ei(),this.hasOwnProperty(Io("properties"))){let a=this.properties,n=[...l4(a),...u4(a)];for(let r of n)this.createProperty(r,a[r])}let o=this[Symbol.metadata];if(o!==null){let a=litPropertyMetadata.get(o);if(a!==void 0)for(let[n,r]of a)this.elementProperties.set(n,r)}this._$Eh=new Map;for(let[a,n]of this.elementProperties){let r=this._$Eu(a,n);r!==void 0&&this._$Eh.set(r,a)}this.elementStyles=this.finalizeStyles(this.styles)}static finalizeStyles(o){let a=[];if(Array.isArray(o)){let n=new Set(o.flat(1/0).reverse());for(let r of n)a.unshift(K2(r))}else o!==void 0&&a.push(K2(o));return a}static _$Eu(o,a){let n=a.attribute;return n===!1?void 0:typeof n=="string"?n:typeof o=="string"?o.toLowerCase():void 0}constructor(){super(),this._$Ep=void 0,this.isUpdatePending=!1,this.hasUpdated=!1,this._$Em=null,this._$Ev()}_$Ev(){this._$ES=new Promise((o)=>this.enableUpdating=o),this._$AL=new Map,this._$E_(),this.requestUpdate(),this.constructor.l?.forEach((o)=>o(this))}addController(o){(this._$EO??=new Set).add(o),this.renderRoot!==void 0&&this.isConnected&&o.hostConnected?.()}removeController(o){this._$EO?.delete(o)}_$E_(){let o=new Map,a=this.constructor.elementProperties;for(let n of a.keys())this.hasOwnProperty(n)&&(o.set(n,this[n]),delete this[n]);o.size>0&&(this._$Ep=o)}createRenderRoot(){let o=this.shadowRoot??this.attachShadow(this.constructor.shadowRootOptions);return C0(o,this.constructor.elementStyles),o}connectedCallback(){this.renderRoot??=this.createRenderRoot(),this.enableUpdating(!0),this._$EO?.forEach((o)=>o.hostConnected?.())}enableUpdating(o){}disconnectedCallback(){this._$EO?.forEach((o)=>o.hostDisconnected?.())}attributeChangedCallback(o,a,n){this._$AK(o,n)}_$ET(o,a){let n=this.constructor.elementProperties.get(o),r=this.constructor._$Eu(o,n);if(r!==void 0&&n.reflect===!0){let i=(n.converter?.toAttribute!==void 0?n.converter:jo).toAttribute(a,n.type);this._$Em=o,i==null?this.removeAttribute(r):this.setAttribute(r,i),this._$Em=null}}_$AK(o,a){let n=this.constructor,r=n._$Eh.get(o);if(r!==void 0&&this._$Em!==r){let i=n.getPropertyOptions(r),c=typeof i.converter=="function"?{fromAttribute:i.converter}:i.converter?.fromAttribute!==void 0?i.converter:jo;this._$Em=r;let t=c.fromAttribute(a,i.type);this[r]=t??this._$Ej?.get(r)??t,this._$Em=null}}requestUpdate(o,a,n,r=!1,i){if(o!==void 0){let c=this.constructor;if(r===!1&&(i=this[o]),n??=c.getPropertyOptions(o),!((n.hasChanged??g2)(i,a)||n.useDefault&&n.reflect&&i===this._$Ej?.get(o)&&!this.hasAttribute(c._$Eu(o,n))))return;this.C(o,a,n)}this.isUpdatePending===!1&&(this._$ES=this._$EP())}C(o,a,{useDefault:n,reflect:r,wrapped:i},c){n&&!(this._$Ej??=new Map).has(o)&&(this._$Ej.set(o,c??a??this[o]),i!==!0||c!==void 0)||(this._$AL.has(o)||(this.hasUpdated||n||(a=void 0),this._$AL.set(o,a)),r===!0&&this._$Em!==o&&(this._$Eq??=new Set).add(o))}async _$EP(){this.isUpdatePending=!0;try{await this._$ES}catch(a){Promise.reject(a)}let o=this.scheduleUpdate();return o!=null&&await o,!this.isUpdatePending}scheduleUpdate(){return this.performUpdate()}performUpdate(){if(!this.isUpdatePending)return;if(!this.hasUpdated){if(this.renderRoot??=this.createRenderRoot(),this._$Ep){for(let[r,i]of this._$Ep)this[r]=i;this._$Ep=void 0}let n=this.constructor.elementProperties;if(n.size>0)for(let[r,i]of n){let{wrapped:c}=i,t=this[r];c!==!0||this._$AL.has(r)||t===void 0||this.C(r,void 0,i,t)}}let o=!1,a=this._$AL;try{o=this.shouldUpdate(a),o?(this.willUpdate(a),this._$EO?.forEach((n)=>n.hostUpdate?.()),this.update(a)):this._$EM()}catch(n){throw o=!1,this._$EM(),n}o&&this._$AE(a)}willUpdate(o){}_$AE(o){this._$EO?.forEach((a)=>a.hostUpdated?.()),this.hasUpdated||(this.hasUpdated=!0,this.firstUpdated(o)),this.updated(o)}_$EM(){this._$AL=new Map,this.isUpdatePending=!1}get updateComplete(){return this.getUpdateComplete()}getUpdateComplete(){return this._$ES}shouldUpdate(o){return!0}update(o){this._$Eq&&=this._$Eq.forEach((a)=>this._$ET(a,this[a])),this._$EM()}updated(o){}firstUpdated(o){}}uo.elementStyles=[],uo.shadowRootOptions={mode:"open"},uo[Io("elementProperties")]=new Map,uo[Io("finalized")]=new Map,b4?.({ReactiveElement:uo}),(m2.reactiveElementVersions??=[]).push("2.1.2");var V2=globalThis,y0=(o)=>o,b2=V2.trustedTypes,M0=b2?b2.createPolicy("lit-html",{createHTML:(o)=>o}):void 0;var mo=`lit$${Math.random().toFixed(9).slice(2)}$`,Y0="?"+mo,h4=`<${Y0}>`,Co=document,Ao=()=>Co.createComment(""),So=(o)=>o===null||typeof o!="object"&&typeof o!="function",H2=Array.isArray,v4=(o)=>H2(o)||typeof o?.[Symbol.iterator]=="function";var Eo=/<(?:(!--|\/[^a-zA-Z])|(\/?[a-zA-Z][^>\s]*)|(\/?$))/g,e0=/-->/g,q0=/>/g,zo=RegExp(`>|[ 	
\f\r](?:([^\\s"'>=/]+)([ 	
\f\r]*=[ 	
\f\r]*(?:[^ 	
\f\r"'\`<>=]|("|')|))|$)`,"g"),k0=/'/g,$0=/"/g,U0=/^(?:script|style|textarea|title)$/i,N2=(o)=>(a,...n)=>({_$litType$:o,strings:a,values:n}),M=N2(1),Z0=N2(2),J0=N2(3),co=Symbol.for("lit-noChange"),T=Symbol.for("lit-nothing"),T0=new WeakMap,Lo=Co.createTreeWalker(Co,129);function B0(o,a){if(!H2(o)||!o.hasOwnProperty("raw"))throw Error("invalid template strings array");return M0!==void 0?M0.createHTML(a):a}var f4=(o,a)=>{let n=o.length-1,r=[],i,c=a===2?"<svg>":a===3?"<math>":"",t=Eo;for(let s=0;s<n;s++){let u=o[s],m,l,b=-1,h=0;for(;h<u.length&&(t.lastIndex=h,l=t.exec(u),l!==null);)h=t.lastIndex,t===Eo?l[1]==="!--"?t=e0:l[1]!==void 0?t=q0:l[2]!==void 0?(U0.test(l[2])&&(i=RegExp("</"+l[2],"g")),t=zo):l[3]!==void 0&&(t=zo):t===zo?l[0]===">"?(t=i??Eo,b=-1):l[1]===void 0?b=-2:(b=t.lastIndex-l[2].length,m=l[1],t=l[3]===void 0?zo:l[3]==='"'?$0:k0):t===$0||t===k0?t=zo:t===e0||t===q0?t=Eo:(t=zo,i=void 0);let v=t===zo&&o[s+1].startsWith("/>")?" ":"";c+=t===Eo?u+h4:b>=0?(r.push(m),u.slice(0,b)+"$lit$"+u.slice(b)+mo+v):u+mo+(b===-2?s:v)}return[B0(o,c+(o[n]||"<?>")+(a===2?"</svg>":a===3?"</math>":"")),r]};class Oo{constructor({strings:o,_$litType$:a},n){let r;this.parts=[];let i=0,c=0,t=o.length-1,s=this.parts,[u,m]=f4(o,a);if(this.el=Oo.createElement(u,n),Lo.currentNode=this.el.content,a===2||a===3){let l=this.el.content.firstChild;l.replaceWith(...l.childNodes)}for(;(r=Lo.nextNode())!==null&&s.length<t;){if(r.nodeType===1){if(r.hasAttributes())for(let l of r.getAttributeNames())if(l.endsWith("$lit$")){let b=m[c++],h=r.getAttribute(l).split(mo),v=/([.?@])?(.*)/.exec(b);s.push({type:1,index:i,name:v[2],strings:h,ctor:v[1]==="."?X0:v[1]==="?"?G0:v[1]==="@"?K0:Wo}),r.removeAttribute(l)}else l.startsWith(mo)&&(s.push({type:6,index:i}),r.removeAttribute(l));if(U0.test(r.tagName)){let l=r.textContent.split(mo),b=l.length-1;if(b>0){r.textContent=b2?b2.emptyScript:"";for(let h=0;h<b;h++)r.append(l[h],Ao()),Lo.nextNode(),s.push({type:2,index:++i});r.append(l[b],Ao())}}}else if(r.nodeType===8)if(r.data===Y0)s.push({type:2,index:i});else{let l=-1;for(;(l=r.data.indexOf(mo,l+1))!==-1;)s.push({type:7,index:i}),l+=mo.length-1}i++}}static createElement(o,a){let n=Co.createElement("template");return n.innerHTML=o,n}}function Jo(o,a,n=o,r){if(a===co)return a;let i=r!==void 0?n._$Co?.[r]:n._$Cl,c=So(a)?void 0:a._$litDirective$;return i?.constructor!==c&&(i?._$AO?.(!1),c===void 0?i=void 0:(i=new c(o),i._$AT(o,n,r)),r!==void 0?(n._$Co??=[])[r]=i:n._$Cl=i),i!==void 0&&(a=Jo(o,i._$AS(o,a.values),i,r)),a}class Q0{constructor(o,a){this._$AV=[],this._$AN=void 0,this._$AD=o,this._$AM=a}get parentNode(){return this._$AM.parentNode}get _$AU(){return this._$AM._$AU}u(o){let{el:{content:a},parts:n}=this._$AD,r=(o?.creationScope??Co).importNode(a,!0);Lo.currentNode=r;let i=Lo.nextNode(),c=0,t=0,s=n[0];for(;s!==void 0;){if(c===s.index){let u;s.type===2?u=new Do(i,i.nextSibling,this,o):s.type===1?u=new s.ctor(i,s.name,s.strings,this,o):s.type===6&&(u=new V0(i,this,o)),this._$AV.push(u),s=n[++t]}c!==s?.index&&(i=Lo.nextNode(),c++)}return Lo.currentNode=Co,r}p(o){let a=0;for(let n of this._$AV)n!==void 0&&(n.strings!==void 0?(n._$AI(o,n,a),a+=n.strings.length-2):n._$AI(o[a])),a++}}class Do{get _$AU(){return this._$AM?._$AU??this._$Cv}constructor(o,a,n,r){this.type=2,this._$AH=T,this._$AN=void 0,this._$AA=o,this._$AB=a,this._$AM=n,this.options=r,this._$Cv=r?.isConnected??!0}get parentNode(){let o=this._$AA.parentNode,a=this._$AM;return a!==void 0&&o?.nodeType===11&&(o=a.parentNode),o}get startNode(){return this._$AA}get endNode(){return this._$AB}_$AI(o,a=this){o=Jo(this,o,a),So(o)?o===T||o==null||o===""?(this._$AH!==T&&this._$AR(),this._$AH=T):o!==this._$AH&&o!==co&&this._(o):o._$litType$!==void 0?this.$(o):o.nodeType!==void 0?this.T(o):v4(o)?this.k(o):this._(o)}O(o){return this._$AA.parentNode.insertBefore(o,this._$AB)}T(o){this._$AH!==o&&(this._$AR(),this._$AH=this.O(o))}_(o){this._$AH!==T&&So(this._$AH)?this._$AA.nextSibling.data=o:this.T(Co.createTextNode(o)),this._$AH=o}$(o){let{values:a,_$litType$:n}=o,r=typeof n=="number"?this._$AC(o):(n.el===void 0&&(n.el=Oo.createElement(B0(n.h,n.h[0]),this.options)),n);if(this._$AH?._$AD===r)this._$AH.p(a);else{let i=new Q0(r,this),c=i.u(this.options);i.p(a),this.T(c),this._$AH=i}}_$AC(o){let a=T0.get(o.strings);return a===void 0&&T0.set(o.strings,a=new Oo(o)),a}k(o){H2(this._$AH)||(this._$AH=[],this._$AR());let a=this._$AH,n,r=0;for(let i of o)r===a.length?a.push(n=new Do(this.O(Ao()),this.O(Ao()),this,this.options)):n=a[r],n._$AI(i),r++;r<a.length&&(this._$AR(n&&n._$AB.nextSibling,r),a.length=r)}_$AR(o=this._$AA.nextSibling,a){for(this._$AP?.(!1,!0,a);o!==this._$AB;){let n=y0(o).nextSibling;y0(o).remove(),o=n}}setConnected(o){this._$AM===void 0&&(this._$Cv=o,this._$AP?.(o))}}class Wo{get tagName(){return this.element.tagName}get _$AU(){return this._$AM._$AU}constructor(o,a,n,r,i){this.type=1,this._$AH=T,this._$AN=void 0,this.element=o,this.name=a,this._$AM=r,this.options=i,n.length>2||n[0]!==""||n[1]!==""?(this._$AH=Array(n.length-1).fill(new String),this.strings=n):this._$AH=T}_$AI(o,a=this,n,r){let i=this.strings,c=!1;if(i===void 0)o=Jo(this,o,a,0),c=!So(o)||o!==this._$AH&&o!==co,c&&(this._$AH=o);else{let t=o,s,u;for(o=i[0],s=0;s<i.length-1;s++)u=Jo(this,t[n+s],a,s),u===co&&(u=this._$AH[s]),c||=!So(u)||u!==this._$AH[s],u===T?o=T:o!==T&&(o+=(u??"")+i[s+1]),this._$AH[s]=u}c&&!r&&this.j(o)}j(o){o===T?this.element.removeAttribute(this.name):this.element.setAttribute(this.name,o??"")}}class X0 extends Wo{constructor(){super(...arguments),this.type=3}j(o){this.element[this.name]=o===T?void 0:o}}class G0 extends Wo{constructor(){super(...arguments),this.type=4}j(o){this.element.toggleAttribute(this.name,!!o&&o!==T)}}class K0 extends Wo{constructor(o,a,n,r,i){super(o,a,n,r,i),this.type=5}_$AI(o,a=this){if((o=Jo(this,o,a,0)??T)===co)return;let n=this._$AH,r=o===T&&n!==T||o.capture!==n.capture||o.once!==n.once||o.passive!==n.passive,i=o!==T&&(n===T||r);r&&this.element.removeEventListener(this.name,this,n),i&&this.element.addEventListener(this.name,this,o),this._$AH=o}handleEvent(o){typeof this._$AH=="function"?this._$AH.call(this.options?.host??this.element,o):this._$AH.handleEvent(o)}}class V0{constructor(o,a,n){this.element=o,this.type=6,this._$AN=void 0,this._$AM=a,this.options=n}get _$AU(){return this._$AM._$AU}_$AI(o){Jo(this,o)}}var d4=V2.litHtmlPolyfillSupport;d4?.(Oo,Do),(V2.litHtmlVersions??=[]).push("3.3.3");var H0=(o,a,n)=>{let r=n?.renderBefore??a,i=r._$litPart$;if(i===void 0){let c=n?.renderBefore??null;r._$litPart$=i=new Do(a.insertBefore(Ao(),c),c,void 0,n??{})}return i._$AI(o),i};var I2=globalThis;class xo extends uo{constructor(){super(...arguments),this.renderOptions={host:this},this._$Do=void 0}createRenderRoot(){let o=super.createRenderRoot();return this.renderOptions.renderBefore??=o.firstChild,o}update(o){let a=this.render();this.hasUpdated||(this.renderOptions.isConnected=this.isConnected),super.update(o),this._$Do=H0(a,this.renderRoot,this.renderOptions)}connectedCallback(){super.connectedCallback(),this._$Do?.setConnected(!0)}disconnectedCallback(){super.disconnectedCallback(),this._$Do?.setConnected(!1)}render(){return co}}xo._$litElement$=!0,xo.finalized=!0,I2.litElementHydrateSupport?.({LitElement:xo});var p4=I2.litElementPolyfillSupport;p4?.({LitElement:xo});(I2.litElementVersions??=[]).push("4.2.2");var P=!1;var Y=(o)=>(a,n)=>{n!==void 0?n.addInitializer(()=>{customElements.define(o,a)}):customElements.define(o,a)};var z4={attribute:!0,type:String,converter:jo,reflect:!1,hasChanged:g2},L4=(o=z4,a,n)=>{let{kind:r,metadata:i}=n,c=globalThis.litPropertyMetadata.get(i);if(c===void 0&&globalThis.litPropertyMetadata.set(i,c=new Map),r==="setter"&&((o=Object.create(o)).wrapped=!0),c.set(n.name,o),r==="accessor"){let{name:t}=n;return{set(s){let u=a.get.call(this);a.set.call(this,s),this.requestUpdate(t,u,o,!0,s)},init(s){return s!==void 0&&this.C(t,void 0,o,s),s}}}if(r==="setter"){let{name:t}=n;return function(s){let u=this[t];a.call(this,s),this.requestUpdate(t,u,o,!0,s)}}throw Error("Unsupported decorator location: "+r)};function g(o){return(a,n)=>typeof n=="object"?L4(o,a,n):((r,i,c)=>{let t=i.hasOwnProperty(c);return i.constructor.createProperty(c,r),t?Object.getOwnPropertyDescriptor(i,c):void 0})(o,a,n)}function Fo(o){return g({...o,state:!0,attribute:!1})}var yo=(o,a,n)=>(n.configurable=!0,n.enumerable=!0,Reflect.decorate&&typeof a!="object"&&Object.defineProperty(o,a,n),n);function X(o,a){return(n,r,i)=>{let c=(t)=>t.renderRoot?.querySelector(o)??null;if(a){let{get:t,set:s}=typeof r=="object"?n:i??(()=>{let u=Symbol();return{get(){return this[u]},set(m){this[u]=m}}})();return yo(n,r,{get(){let u=t.call(this);return u===void 0&&(u=c(this),(u!==null||this.hasUpdated)&&s.call(this,u)),u}})}return yo(n,r,{get(){return c(this)}})}}/*! Copyright 2026 Fonticons, Inc. - https://webawesome.com/license */var C4=y`
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
`,x4=/;\s+$/;function F4(o){return o.replace(/[A-Z]/g,(a)=>`-${a.toLowerCase()}`)}function N0(o){let{property:a,value:n,element:r}=o;if(n){let i=r.getAttribute("style")||"";if(i){if(!i.match(x4))i+=";";i+=" "}let c=`${a}: ${n}`;if(i.includes(c))return;return`${i}${c};`}return null}var h2,$=class extends xo{constructor(){super();d0(this,h2,!1),this.initialReflectedProperties=new Map,this.didSSR=P||Boolean(this.shadowRoot),this.customStates={set:(a,n)=>{if(!Boolean(this.internals?.states))return;try{if(n)this.internals.states.add(a);else this.internals.states.delete(a)}catch(r){if(String(r).includes("must start with '--'"))console.error("Your browser implements an outdated version of CustomStateSet. Consider using a polyfill");else throw r}},has:(a)=>{if(!Boolean(this.internals?.states))return!1;try{return this.internals.states.has(a)}catch{return!1}}};try{this.internals=this.attachInternals()}catch{console.error("Element internals are not supported in your browser. Consider using a polyfill")}this.customStates.set("wa-defined",!0);let o=this.constructor;for(let[a,n]of o.elementProperties)if(n.default==="inherit"&&n.initial!==void 0&&typeof a==="string")this.customStates.set(`initial-${a}-${n.initial}`,!0)}static get styles(){let o=Array.isArray(this.css)?this.css:this.css?[this.css]:[];return[C4,...o]}connectedCallback(){if(super.connectedCallback(),!this.didSSR)this.shadowRoot?.prepend(document.createComment(` Web Awesome: https://webawesome.com/docs/components/${this.localName.replace("wa-","")} `));if(this.didSSR)this.updateComplete.then(()=>{this.shadowRoot?.prepend(document.createComment(` Web Awesome: https://webawesome.com/docs/components/${this.localName.replace("wa-","")} `))})}attributeChangedCallback(o,a,n){if(!f0(this,h2))this.constructor.elementProperties.forEach((r,i)=>{if(r.reflect&&this[i]!=null)this.initialReflectedProperties.set(i,this[i])}),p0(this,h2,!0);super.attributeChangedCallback(o,a,n)}willUpdate(o){super.willUpdate(o),this.initialReflectedProperties.forEach((a,n)=>{if(o.has(n)&&this[n]==null)this[n]=a})}firstUpdated(o){if(super.firstUpdated(o),this.didSSR)this.shadowRoot?.querySelectorAll("slot").forEach((a)=>{a.dispatchEvent(new Event("slotchange",{bubbles:!0,composed:!1,cancelable:!1}))})}update(o){try{super.update(o)}catch(a){if(this.didSSR&&!this.hasUpdated){let n=new Event("lit-hydration-error",{bubbles:!0,composed:!0,cancelable:!1});n.error=a,this.dispatchEvent(n)}throw a}}setStyle(o,a){if(!this.style){let n=N0({property:F4(o),value:a,element:this});if(n)this.setAttribute("style",n);return}this.style[o]=a}setStyleProperty(o,a){if(!this.style){let n=N0({property:o,value:a,element:this});if(n)this.setAttribute("style",n);return}this.style.setProperty(o,a)}relayNativeEvent(o,a){o.stopImmediatePropagation(),this.dispatchEvent(new o.constructor(o.type,{...o,...a}))}};h2=new WeakMap;w([g()],$.prototype,"dir",2);w([g()],$.prototype,"lang",2);w([g({type:Boolean,reflect:!0,attribute:"did-ssr"})],$.prototype,"didSSR",2);/*! Copyright 2026 Fonticons, Inc. - https://webawesome.com/license */var y4=()=>{return{observedAttributes:["custom-error"],checkValidity(o){let a={message:"",isValid:!0,invalidKeys:[]};if(o.customError)a.message=o.customError,a.isValid=!1,a.invalidKeys=["customError"];return a}}},R=class extends ${constructor(){super();if(this.name=null,this.disabled=!1,this.required=!1,this.assumeInteractionOn=["input"],this.validators=[],this.valueHasChanged=!1,this.hasInteracted=!1,this.customError=null,this.emittedEvents=[],this.emitInvalid=(o)=>{if(o.target!==this)return;this.hasInteracted=!0,this.dispatchEvent(new s2)},this.handleInteraction=(o)=>{let a=this.emittedEvents;if(!a.includes(o.type))a.push(o.type);if(a.length===this.assumeInteractionOn?.length)this.hasInteracted=!0},"addEventListener"in this)this.addEventListener("invalid",this.emitInvalid)}static get validators(){return P?[]:[y4()]}static get observedAttributes(){let o=new Set(super.observedAttributes||[]);for(let a of this.validators){if(!a.observedAttributes)continue;for(let n of a.observedAttributes)o.add(n)}return[...o]}connectedCallback(){if(super.connectedCallback(),this.didSSR&&!this.hasUpdated)this.updateComplete.then(()=>{this.updateValidity()});else this.updateValidity();this.assumeInteractionOn.forEach((o)=>{this.addEventListener?.(o,this.handleInteraction)})}firstUpdated(...o){super.firstUpdated(...o),this.updateValidity()}willUpdate(o){if(!P&&o.has("customError")){if(!this.customError)this.customError=null;this.setCustomValidity(this.customError||"")}if(o.has("value")||o.has("disabled")||o.has("defaultValue")){let a=this.value;this.updateFormValue(a)}if(o.has("disabled")){if(this.customStates.set("disabled",this.disabled),this.hasAttribute("disabled")||!P&&!this.matches(":disabled"))this.toggleAttribute("disabled",this.disabled)}if(super.willUpdate(o),this.didSSR&&!this.hasUpdated)this.updateComplete.then(()=>this.updateValidity());else this.updateValidity()}updateFormValue(o){if(Array.isArray(o)){if(this.name){let a=new FormData;for(let n of o)a.append(this.name,n);this.setValue(a,a)}}else this.setValue(o,o)}get labels(){return this.internals.labels}getForm(){return this.internals.form}set form(o){if(o)this.setAttribute("form",o);else this.removeAttribute("form")}get form(){return this.internals.form}get validity(){return this.internals.validity}get willValidate(){return this.internals.willValidate}get validationMessage(){return this.internals.validationMessage}checkValidity(){return this.updateValidity(),this.internals.checkValidity()}reportValidity(){return this.updateValidity(),this.hasInteracted=!0,this.internals.reportValidity()}get validationTarget(){return this.input||void 0}setValidity(...o){let a=o[0],n=o[1],r=o[2];if(!r)r=this.validationTarget;this.internals.setValidity(a,n,r||void 0),this.requestUpdate("validity"),this.setCustomStates()}setCustomStates(){let o=Boolean(this.required),a=this.internals.validity.valid,n=this.hasInteracted;this.customStates.set("required",o),this.customStates.set("optional",!o),this.customStates.set("invalid",!a),this.customStates.set("valid",a),this.customStates.set("user-invalid",!a&&n),this.customStates.set("user-valid",a&&n)}setCustomValidity(o){if(!o){this.customError=null,this.setValidity({});return}this.customError=o,this.setValidity({customError:!0},o,this.validationTarget)}formResetCallback(){this.resetValidity(),this.hasInteracted=!1,this.valueHasChanged=!1,this.emittedEvents=[],this.updateValidity()}formDisabledCallback(o){this.disabled=o,this.updateValidity()}formStateRestoreCallback(o,a){if(this.didSSR&&!this.hasUpdated)this.updateComplete.then(()=>{if(this.value=o,a==="restore")this.resetValidity();this.updateValidity()});else{if(this.value=o,a==="restore")this.resetValidity();this.updateValidity()}}setValue(...o){let[a,n]=o;this.internals.setFormValue(a,n)}get allValidators(){let o=this.constructor.validators||[],a=this.validators||[];return[...o,...a]}resetValidity(){this.setCustomValidity(""),this.setValidity({})}updateValidity(){if(this.disabled||this.hasAttribute("disabled")||!this.willValidate){this.resetValidity();return}let o=this.allValidators;if(!o?.length)return;let a={customError:Boolean(this.customError)},n=this.validationTarget||this.input||void 0,r="";for(let i of o){let{isValid:c,message:t,invalidKeys:s}=i.checkValidity(this);if(c)continue;if(!r)r=t;if(s?.length>=0)s.forEach((u)=>a[u]=!0)}if(!r)r=this.validationMessage;this.setValidity(a,r,n)}};R.formAssociated=!0;w([g({reflect:!0})],R.prototype,"name",2);w([g({type:Boolean})],R.prototype,"disabled",2);w([g({state:!0,attribute:!1})],R.prototype,"valueHasChanged",2);w([g({state:!0,attribute:!1})],R.prototype,"hasInteracted",2);w([g({attribute:"custom-error",reflect:!0})],R.prototype,"customError",2);w([g({attribute:!1,state:!0,type:Object})],R.prototype,"validity",1);/*! Copyright 2026 Fonticons, Inc. - https://webawesome.com/license */var I0={small:"s",medium:"m",large:"l"},j0=new Set;function Bo(o,a){if(a in I0&&!j0.has(`${o}:${a}`))j0.add(`${o}:${a}`),console.warn(`[${o}] size="${a}" is deprecated. Use size="${I0[a]}" instead. The long-form value will be removed in the next major version.`)}/*! Copyright 2026 Fonticons, Inc. - https://webawesome.com/license */var go=class{constructor(o,...a){this.slotNames=[],this.handleSlotChange=(n)=>{let r=n.target;if(this.slotNames.includes("[default]")&&!r.name||r.name&&this.slotNames.includes(r.name))this.host.requestUpdate()},(this.host=o).addController(this),this.slotNames=a}hasDefaultSlot(){if(!this.host.childNodes)return!1;return[...this.host.childNodes].some((o)=>{if(o.nodeType===Node.TEXT_NODE&&o.textContent.trim()!=="")return!0;if(o.nodeType===Node.ELEMENT_NODE){let a=o;if(a.tagName.toLowerCase()==="wa-visually-hidden")return!1;if(!a.hasAttribute("slot"))return!0}return!1})}hasNamedSlot(o){return this.host.querySelector?.(`:scope > [slot="${o}"]`)!==null}test(o,a){if(a&&this.host.didSSR&&!this.host.hasUpdated)return Boolean(this.host[a]);return o==="[default]"?this.hasDefaultSlot():this.hasNamedSlot(o)}hostConnected(){let o=this.host.shadowRoot;if(o&&"addEventListener"in o)o.addEventListener("slotchange",this.handleSlotChange)}hostDisconnected(){let o=this.host.shadowRoot;if(o&&"removeEventListener"in o)o.removeEventListener("slotchange",this.handleSlotChange)}};/*! Copyright 2026 Fonticons, Inc. - https://webawesome.com/license */var v2=y`
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
`;/*! Copyright 2026 Fonticons, Inc. - https://webawesome.com/license */var E0=y`
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
`;/*! Copyright 2026 Fonticons, Inc. - https://webawesome.com/license */var A0=y`
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
`;/*! Copyright 2026 Fonticons, Inc. - https://webawesome.com/license */function B(o,a){let n={waitUntilFirstUpdate:!1,...a};return(r,i)=>{let{update:c}=r,t=Array.isArray(o)?o:[o];r.update=function(s){t.forEach((u)=>{let m=u;if(s.has(m)){let l=s.get(m),b=this[m];if(l!==b){if(!n.waitUntilFirstUpdate||this.hasUpdated)this[i](l,b)}}}),c.call(this,s)}}}var j2=new Set,Qo=new Map,to,E2="ltr",A2="en",S0=typeof MutationObserver<"u"&&typeof document<"u"&&typeof document.documentElement<"u";if(S0){let o=new MutationObserver(O0);E2=document.documentElement.dir||"ltr",A2=document.documentElement.lang||navigator.language,o.observe(document.documentElement,{attributes:!0,attributeFilter:["dir","lang"]})}function Mo(...o){o.map((a)=>{let n=a.$code.toLowerCase();if(Qo.has(n))Qo.set(n,Object.assign(Object.assign({},Qo.get(n)),a));else Qo.set(n,a);if(!to)to=a}),O0()}function O0(){if(S0)E2=document.documentElement.dir||"ltr",A2=document.documentElement.lang||navigator.language;[...j2.keys()].map((o)=>{if(typeof o.requestUpdate==="function")o.requestUpdate()})}class S2{constructor(o){this.host=o,this.host.addController(this)}hostConnected(){j2.add(this.host)}hostDisconnected(){j2.delete(this.host)}dir(){return`${this.host.dir||E2}`.toLowerCase()}lang(){let o=`${this.host.lang||A2}`.toLowerCase().replace(/_/g,"-");try{return new Intl.Locale(o),o}catch(a){return to?to.$code.toLowerCase():"en"}}getTranslationData(o){var a,n;let r;try{r=new Intl.Locale(o.replace(/_/g,"-"))}catch(u){return{locale:void 0,language:"",region:"",primary:void 0,secondary:void 0}}let i=r.language.toLowerCase(),c=(n=(a=r.region)===null||a===void 0?void 0:a.toLowerCase())!==null&&n!==void 0?n:"",t=Qo.get(`${i}-${c}`),s=Qo.get(i);return{locale:r,language:i,region:c,primary:t,secondary:s}}exists(o,a){var n;let{primary:r,secondary:i}=this.getTranslationData((n=a.lang)!==null&&n!==void 0?n:this.lang());if(a=Object.assign({includeFallback:!1},a),r&&r[o]||i&&i[o]||a.includeFallback&&to&&to[o])return!0;return!1}term(o,...a){let{primary:n,secondary:r}=this.getTranslationData(this.lang()),i;if(n&&n[o])i=n[o];else if(r&&r[o])i=r[o];else if(to&&to[o])i=to[o];else return console.error(`No translation found for: ${String(o)}`),String(o);if(typeof i==="function")return i(...a);return i}date(o,a){return o=new Date(o),new Intl.DateTimeFormat(this.lang(),a).format(o)}number(o,a){return o=Number(o),isNaN(o)?"":new Intl.NumberFormat(this.lang(),a).format(o)}relativeTime(o,a,n){return new Intl.RelativeTimeFormat(this.lang(),n).format(o,a)}}/*! Copyright 2026 Fonticons, Inc. - https://webawesome.com/license */var D0={$code:"en",$name:"English",$dir:"ltr",allTagsRemoved:"All tags removed",am:"AM",autosizeColumn:"Autosize column",captions:"Captions",carousel:"Carousel",chooseDate:"Choose date",chooseDecade:"Choose decade",chooseMonth:"Choose month",chooseTime:"Choose time",chooseYear:"Choose year",clearEntry:"Clear entry",clearFilter:"Clear filter",clearSort:"Clear sort",close:"Close",closeCalendar:"Close calendar",closeTimeInput:"Close time picker",collapseRow:"Collapse row",columnMenu:"Column options",columnMovedToPosition:(o,a,n)=>`${o} moved to position ${a} of ${n}`,columns:"Columns",compactPageXOfY:(o,a)=>`${o} of ${a}`,completed:"Completed",copied:"Copied",copy:"Copy",createOption:(o)=>`Create "${o}"`,currentlyPlaying:"currently playing",currentValue:"Current value",date:"Date",datePickerKeyboardHelp:"Use arrow keys to change values; press Alt+Down Arrow to open the calendar.",day:"Day",dayPeriod:"AM/PM",decrement:"Decrement",deselectAllRows:"Deselect all rows",disabled:"Disabled",dropFileHere:"Drop file here or click to browse",dropFilesHere:"Drop files here or click to browse",empty:"Empty",endDate:"End date",enterFullscreen:"Enter fullscreen",error:"Error",exitFullscreen:"Exit fullscreen",expandRow:"Expand row",filterByColumn:(o)=>`Filter by ${o}`,filterFrom:"From",filterMax:"Max",filterMin:"Min",filterTo:"To",firstPage:"First page",goToSlide:(o,a)=>`Go to slide ${o} of ${a}`,hideColumn:"Hide column",hidePassword:"Hide password",hour:"Hour",incompleteDate:"Enter a valid date.",increment:"Increment",jumpBackwardX:(o)=>`Jump back ${o} pages`,jumpForwardX:(o)=>`Jump forward ${o} pages`,lastPage:"Last page",loading:"Loading",locked:"Locked",minute:"Minute",month:"Month",moreOptions:"More Options",mute:"Mute",nextDecade:"Next decade",nextMonth:"Next month",nextPage:"Next page",nextSlide:"Next slide",nextVideo:"Next Video",nextYear:"Next year",noData:"No data",noOptions:"No options",noResults:"No matching results",notCompleted:"Not completed",now:"Now",numCharacters:(o)=>{if(o===1)return"1 character";return`${o} characters`},numCharactersRemaining:(o)=>{if(o===1)return"1 character remaining";return`${o} characters remaining`},numOptionsAvailable:(o)=>{if(o===0)return"No options available";if(o===1)return"1 option available";return`${o} options available`},numOptionsSelected:(o)=>{if(o===0)return"No options selected";if(o===1)return"1 option selected";return`${o} options selected`},numRowsCopied:(o)=>o===1?"1 row copied":`${o} rows copied`,numRowsSelected:(o)=>o===1?"1 row selected":`${o} rows selected`,optionPosition:(o,a,n)=>`${o}, ${a} of ${n}`,optionsLoadError:"Options could not be loaded",pageXOfY:(o,a)=>`Page ${o} of ${a}`,pagination:"Pagination",pause:"Pause",pauseAnimation:"Pause animation",pictureInPicture:"Picture in picture",pinLeft:"Pin left",pinRight:"Pin right",play:"Play",playAnimation:"Play animation",playbackSpeed:"Playback speed",playlist:"Playlist",pm:"PM",previousDecade:"Previous decade",previousMonth:"Previous month",previousPage:"Previous page",previousSlide:"Previous slide",previousVideo:"Previous video",previousYear:"Previous year",progress:"Progress",rangeTooLong:(o)=>{if(o===1)return"Select a range no longer than 1 day";return`Select a range no longer than ${o} days`},rangeTooShort:(o)=>{if(o===1)return"Select a range at least 1 day long";return`Select a range at least ${o} days long`},readonly:"Read-only",remove:"Remove",resetColumns:"Reset columns",resize:"Resize",resizeColumn:"Resize column",rowsPerPage:"Rows per page",scrollableRegion:"Scrollable region",scrollToEnd:"Scroll to end",scrollToStart:"Scroll to start",search:"Search",second:"Second",seek:"Seek",seekProgress:(o,a)=>`${o} of ${a}`,selectAColorFromTheScreen:"Select a color from the screen",selectAllRows:"Select all rows",selected:"Selected",selectedDateLabel:(o)=>`Selected: ${o}`,selectedRangeLabel:(o)=>`Selected range: ${o}`,selectGroup:"Select group",selectionCleared:"Selection cleared",selectRow:"Select row",showingNofMRows:(o,a)=>`Showing ${o} of ${a} rows`,showingXtoYofZ:(o,a,n)=>`${o}–${a} of ${n}`,showPassword:"Show password",slideNum:(o)=>`Slide ${o}`,sortAscending:"Sort ascending",sortColumn:"Sort column",sortDescending:"Sort descending",startDate:"Start date",steps:"Steps",stepXOfY:(o,a)=>`Step ${o} of ${a}`,tagAdded:(o)=>`${o} added`,tagAlreadyAdded:(o)=>`${o} is already added`,tagInputKeyboardHelp:"Press Backspace or Delete to remove this tag.",tagRemoved:(o)=>`${o} removed`,time:"Time",timeInputKeyboardHelp:"Use arrow keys to change values; press Alt+Down Arrow to open the time picker.",today:"Today",toggleColorFormat:"Toggle color format",tooFewTags:(o)=>o===1?"Add at least 1 tag":`Add at least ${o} tags`,tooManyTags:(o)=>o===1?"Add no more than 1 tag":`Add no more than ${o} tags`,unmute:"Unmute",unpin:"Unpin",unpinColumn:"Unpin column",videoPlayer:"Video player",volume:"Volume",year:"Year",zoomIn:"Zoom in",zoomOut:"Zoom out"};Mo(D0);var W0=D0;/*! Copyright 2026 Fonticons, Inc. - https://webawesome.com/license */var _=class extends S2{lang(){if(this.host.didSSR&&!this.host.hasUpdated)return this.host.lang||"en";return super.lang()}};Mo(W0);var P0={ATTRIBUTE:1,CHILD:2,PROPERTY:3,BOOLEAN_ATTRIBUTE:4,EVENT:5,ELEMENT:6},R0=(o)=>(...a)=>({_$litDirective$:o,values:a});class O2{constructor(o){}get _$AU(){return this._$AM._$AU}_$AT(o,a,n){this._$Ct=o,this._$AM=a,this._$Ci=n}_$AS(o,a){return this.update(o,a)}update(o,a){return this.render(...a)}}var eo=R0(class extends O2{constructor(o){if(super(o),o.type!==P0.ATTRIBUTE||o.name!=="class"||o.strings?.length>2)throw Error("`classMap()` can only be used in the `class` attribute and must be the only part in the attribute.")}render(o){return" "+Object.keys(o).filter((a)=>o[a]).join(" ")+" "}update(o,[a]){if(this.st===void 0){this.st=new Set,o.strings!==void 0&&(this.nt=new Set(o.strings.join(" ").split(/\s/).filter((r)=>r!=="")));for(let r in a)a[r]&&!this.nt?.has(r)&&this.st.add(r);return this.render(a)}let n=o.element.classList;for(let r of this.st)r in a||(n.remove(r),this.st.delete(r));for(let r in a){let i=!!a[r];i===this.st.has(r)||this.nt?.has(r)||(i?(n.add(r),this.st.add(r)):(n.remove(r),this.st.delete(r)))}return co}});var U=(o)=>o??T;var o1=Symbol.for(""),M4=(o)=>{if(o?.r===o1)return o?._$litStatic$};var D2=(o,...a)=>({_$litStatic$:a.reduce((n,r,i)=>n+((c)=>{if(c._$litStatic$!==void 0)return c._$litStatic$;throw Error(`Value passed to 'literal' function must be a 'literal' result: ${c}. Use 'unsafeStatic' to pass non-literal values, but
            take care to ensure page security.`)})(r)+o[i+1],o[0]),r:o1}),_0=new Map,W2=(o)=>(a,...n)=>{let r=n.length,i,c,t=[],s=[],u,m=0,l=!1;for(;m<r;){for(u=a[m];m<r&&(c=n[m],i=M4(c))!==void 0;)u+=i+a[++m],l=!0;m!==r&&s.push(c),t.push(u),m++}if(m===r&&t.push(a[r]),l){let b=t.join("$$lit$$");(a=_0.get(b))===void 0&&(t.raw=t,_0.set(b,a=t)),n=s}return o(a,...n)},f2=W2(M),S3=W2(Z0),O3=W2(J0);/*! Copyright 2026 Fonticons, Inc. - https://webawesome.com/license */var z=class extends R{constructor(){super(...arguments);this.assumeInteractionOn=["click"],this.hasSlotController=new go(this,"[default]","start","end"),this.localize=new _(this),this.invalid=!1,this.isIconButton=!1,this.title="",this.variant="neutral",this.appearance="accent",this.size="m",this.withCaret=!1,this.withStart=!1,this.withEnd=!1,this.disabled=!1,this.loading=!1,this.pill=!1,this.type="button"}static get validators(){return[...super.validators,b0()]}handleSizeChange(){Bo(this.localName,this.size)}constructLightDOMButton(){let o=document.createElement("button");for(let a of this.attributes){if(a.name==="style")continue;o.setAttribute(a.name,a.value)}if(o.type=this.type,o.style.position="absolute !important",o.style.width="0 !important",o.style.height="0 !important",o.style.clipPath="inset(50%) !important",o.style.overflow="hidden !important",o.style.whiteSpace="nowrap !important",this.name)o.name=this.name;return o.value=this.value||"",o}handleClick(o){if(this.disabled||this.loading){o.preventDefault(),o.stopImmediatePropagation();return}if(this.type!=="submit"&&this.type!=="reset")return;if(!this.getForm())return;let n=this.constructLightDOMButton();this.parentElement?.append(n),n.click(),n.remove()}handleInvalid(){this.dispatchEvent(new s2)}handleLabelSlotChange(){let o=this.labelSlot.assignedNodes({flatten:!0}),a=!1,n=!1,r=!1,i=!1;if([...o].forEach((c)=>{if(c.nodeType===Node.ELEMENT_NODE){let t=c;if(t.localName==="wa-icon"){if(n=!0,!a)a=t.label!==void 0}else i=!0}else if(c.nodeType===Node.TEXT_NODE){if((c.textContent?.trim()||"").length>0)r=!0}}),this.isIconButton=n&&!r&&!i,this.customStates.set("icon-button",this.isIconButton),this.isIconButton&&!a)console.warn('Icon buttons must have a label for screen readers. Add <wa-icon label="..."> to remove this warning.',this)}isButton(){return this.href?!1:!0}isLink(){return this.href?!0:!1}handleDisabledChange(){this.customStates.set("disabled",this.disabled),this.updateValidity()}handleHrefChange(){this.customStates.set("link",this.isLink())}handleLoadingChange(){this.customStates.set("loading",this.loading)}setValue(...o){}click(){this.button.click()}focus(o){this.button.focus(o)}blur(){this.button.blur()}render(){let o=this.isLink(),a=o?D2`a`:D2`button`;return f2`
      <${a}
        part="base button"
        class=${eo({button:!0,caret:this.withCaret,disabled:this.disabled,loading:this.loading,rtl:this.localize.dir()==="rtl","has-label":this.hasSlotController.test("[default]"),"has-start":this.hasSlotController.test("start","withStart"),"has-end":this.hasSlotController.test("end","withEnd"),"is-icon-button":this.isIconButton})}
        ?disabled=${U(o?void 0:this.disabled)}
        type=${U(o?void 0:this.type)}
        title=${this.title}
        name=${U(o?void 0:this.name)}
        value=${U(o?void 0:this.value)}
        href=${U(o?this.href:void 0)}
        target=${U(o?this.target:void 0)}
        download=${U(o?this.download:void 0)}
        rel=${U(o&&this.rel?this.rel:void 0)}
        role=${U(o?void 0:"button")}
        aria-disabled=${U(o&&this.disabled?"true":void 0)}
        aria-busy=${this.loading?"true":"false"}
        tabindex=${this.disabled?"-1":"0"}
        @invalid=${this.isButton()?this.handleInvalid:null}
        @click=${this.handleClick}
      >
        <slot name="start" part="start" class="start"></slot>
        <slot part="label" class="label" @slotchange=${this.handleLabelSlotChange}></slot>
        <slot name="end" part="end" class="end"></slot>
        ${this.withCaret?f2`
                <wa-icon part="caret" class="caret" library="system" name="chevron-down" variant="solid"></wa-icon>
              `:""}
        ${this.loading?f2`<wa-spinner part="spinner"></wa-spinner>`:""}
      </${a}>
    `}};z.shadowRootOptions={...R.shadowRootOptions,delegatesFocus:!0};z.css=[E0,A0,v2];w([X(".button")],z.prototype,"button",2);w([X("slot:not([name])")],z.prototype,"labelSlot",2);w([Fo()],z.prototype,"invalid",2);w([Fo()],z.prototype,"isIconButton",2);w([g()],z.prototype,"title",2);w([g({reflect:!0})],z.prototype,"variant",2);w([g({reflect:!0})],z.prototype,"appearance",2);w([g({reflect:!0})],z.prototype,"size",2);w([B("size")],z.prototype,"handleSizeChange",1);w([g({attribute:"with-caret",type:Boolean,reflect:!0})],z.prototype,"withCaret",2);w([g({attribute:"with-start",type:Boolean})],z.prototype,"withStart",2);w([g({attribute:"with-end",type:Boolean})],z.prototype,"withEnd",2);w([g({type:Boolean})],z.prototype,"disabled",2);w([g({type:Boolean,reflect:!0})],z.prototype,"loading",2);w([g({type:Boolean,reflect:!0})],z.prototype,"pill",2);w([g()],z.prototype,"type",2);w([g({reflect:!0})],z.prototype,"name",2);w([g({reflect:!0})],z.prototype,"value",2);w([g({reflect:!0})],z.prototype,"href",2);w([g()],z.prototype,"target",2);w([g()],z.prototype,"rel",2);w([g()],z.prototype,"download",2);w([g({attribute:"formaction"})],z.prototype,"formAction",2);w([g({attribute:"formenctype"})],z.prototype,"formEnctype",2);w([g({attribute:"formmethod"})],z.prototype,"formMethod",2);w([g({attribute:"formnovalidate",type:Boolean})],z.prototype,"formNoValidate",2);w([g({attribute:"formtarget"})],z.prototype,"formTarget",2);w([B("disabled",{waitUntilFirstUpdate:!0})],z.prototype,"handleDisabledChange",1);w([B("href")],z.prototype,"handleHrefChange",1);w([B("loading",{waitUntilFirstUpdate:!0})],z.prototype,"handleLoadingChange",1);z=w([Y("wa-button")],z);z.disableWarning?.("change-in-update");/*! Copyright 2026 Fonticons, Inc. - https://webawesome.com/license */var a1=y`
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
`;/*! Copyright 2026 Fonticons, Inc. - https://webawesome.com/license */var P2=class extends ${constructor(){super(...arguments);this.localize=new _(this)}render(){return M`
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
    `}};P2.css=a1;P2=w([Y("wa-spinner")],P2);/*! Copyright 2026 Fonticons, Inc. - https://webawesome.com/license */var n1=class extends Event{constructor(){super("wa-error",{bubbles:!0,cancelable:!1,composed:!0})}};/*! Copyright 2026 Fonticons, Inc. - https://webawesome.com/license */var r1=class extends Event{constructor(){super("wa-load",{bubbles:!0,cancelable:!1,composed:!0})}};/*! Copyright 2026 Fonticons, Inc. - https://webawesome.com/license */var i1=y`
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
`;/*! Copyright 2026 Fonticons, Inc. - https://webawesome.com/license */var e4="",R2="";function c1(){return e4.replace(/\/$/,"")}function q4(o){R2=o}function t1(){if(!R2){let o=document.querySelector("[data-fa-kit-code]");if(o)q4(o.getAttribute("data-fa-kit-code")||"")}return R2}/*! Copyright 2026 Fonticons, Inc. - https://webawesome.com/license */var s1="7.3.0";function k4(o,a,n){let r="solid";if(a==="chisel")r="chisel-regular";if(a==="etch")r="etch-solid";if(a==="graphite")r="graphite-thin";if(a==="jelly"){if(r="jelly-regular",n==="duo-regular")r="jelly-duo-regular";if(n==="fill-regular")r="jelly-fill-regular"}if(a==="jelly-duo")r="jelly-duo-regular";if(a==="jelly-fill")r="jelly-fill-regular";if(a==="notdog"){if(n==="solid")r="notdog-solid";if(n==="duo-solid")r="notdog-duo-solid"}if(a==="notdog-duo")r="notdog-duo-solid";if(a==="slab"){if(n==="solid"||n==="regular")r="slab-regular";if(n==="press-regular")r="slab-press-regular"}if(a==="slab-press")r="slab-press-regular";if(a==="slab-duo")r="slab-duo-regular";if(a==="slab-press-duo")r="slab-press-duo-regular";if(a==="thumbprint")r="thumbprint-light";if(a==="utility")r="utility-semibold";if(a==="utility-duo")r="utility-duo-semibold";if(a==="utility-fill")r="utility-fill-semibold";if(a==="whiteboard")r="whiteboard-semibold";if(a==="mosaic")r="mosaic-solid";if(a==="pixel")r="pixel-regular";if(a==="vellum")r="vellum-solid";if(a==="classic"){if(n==="thin")r="thin";if(n==="light")r="light";if(n==="regular")r="regular";if(n==="solid")r="solid"}if(a==="duotone"){if(n==="thin")r="duotone-thin";if(n==="light")r="duotone-light";if(n==="regular")r="duotone-regular";if(n==="solid")r="duotone"}if(a==="sharp"){if(n==="thin")r="sharp-thin";if(n==="light")r="sharp-light";if(n==="regular")r="sharp-regular";if(n==="solid")r="sharp-solid"}if(a==="sharp-duotone"){if(n==="thin")r="sharp-duotone-thin";if(n==="light")r="sharp-duotone-light";if(n==="regular")r="sharp-duotone-regular";if(n==="solid")r="sharp-duotone-solid"}if(a==="brands")r="brands";return r}function $4(o,a,n){let r=k4(o,a,n),i=c1();if(i)return`${i}/${r}/${o}.svg`;let c=t1();return c.length>0?`https://ka-p.fontawesome.com/releases/v${s1}/svgs/${r}/${o}.svg?token=${encodeURIComponent(c)}`:`https://ka-f.fontawesome.com/releases/v${s1}/svgs/${r}/${o}.svg`}var T4={name:"default",resolver:(o,a="classic",n="solid")=>{return $4(o,a,n)},mutator:(o,a)=>{if(!o.hasAttribute("fill"))o.setAttribute("fill","currentColor");if(a?.family&&!o.hasAttribute("data-duotone-initialized")){let{family:n,variant:r}=a;if(n==="duotone"||n==="sharp-duotone"||n==="notdog-duo"||n==="notdog"&&r==="duo-solid"||n==="jelly-duo"||n==="jelly"&&r==="duo-regular"||n==="utility-duo"||n==="slab-duo"||n==="slab-press-duo"||n==="thumbprint"){let i=[...o.querySelectorAll("path")],c=i.find((s)=>!s.hasAttribute("opacity")),t=i.find((s)=>s.hasAttribute("opacity"));if(!c||!t)return;if(c.setAttribute("data-duotone-primary",""),t.setAttribute("data-duotone-secondary",""),a.swapOpacity&&c&&t){let s=t.getAttribute("opacity")||"0.4";c.style.setProperty("--path-opacity",s),t.style.setProperty("--path-opacity","1")}o.setAttribute("data-duotone-initialized","")}}}},w1=T4;/*! Copyright 2026 Fonticons, Inc. - https://webawesome.com/license */function Y4(o){return`data:image/svg+xml,${encodeURIComponent(o)}`}var _2={solid:{"arrow-down":'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 384 512"><!--!Font Awesome Free v7.2.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2026 Fonticons, Inc.--><path d="M169.4 502.6c12.5 12.5 32.8 12.5 45.3 0l160-160c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0L224 402.7 224 32c0-17.7-14.3-32-32-32s-32 14.3-32 32l0 370.7-105.4-105.4c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3l160 160z"/></svg>',"arrow-up":'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 384 512"><!--!Font Awesome Free v7.2.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2026 Fonticons, Inc.--><path d="M214.6 9.4c-12.5-12.5-32.8-12.5-45.3 0l-160 160c-12.5 12.5-12.5 32.8 0 45.3s32.8 12.5 45.3 0L160 109.3 160 480c0 17.7 14.3 32 32 32s32-14.3 32-32l0-370.7 105.4 105.4c12.5 12.5 32.8 12.5 45.3 0s12.5-32.8 0-45.3l-160-160z"/></svg>',backward:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640"><!--!Font Awesome Free v7.2.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2026 Fonticons, Inc.--><path d="M236.3 107.1C247.9 96 265 92.9 279.7 99.2C294.4 105.5 304 120 304 136L304 272.3L476.3 107.2C487.9 96 505 92.9 519.7 99.2C534.4 105.5 544 120 544 136L544 504C544 520 534.4 534.5 519.7 540.8C505 547.1 487.9 544 476.3 532.9L304 367.7L304 504C304 520 294.4 534.5 279.7 540.8C265 547.1 247.9 544 236.3 532.9L44.3 348.9C36.5 341.3 32 330.9 32 320C32 309.1 36.5 298.7 44.3 291.1L236.3 107.1z"/></svg>',"backward-step":'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640"><!--!Font Awesome Free v7.2.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2026 Fonticons, Inc.--><path d="M491 100.8C478.1 93.8 462.3 94.5 450 102.6L192 272.1L192 128C192 110.3 177.7 96 160 96C142.3 96 128 110.3 128 128L128 512C128 529.7 142.3 544 160 544C177.7 544 192 529.7 192 512L192 367.9L450 537.5C462.3 545.6 478 546.3 491 539.3C504 532.3 512 518.8 512 504.1L512 136.1C512 121.4 503.9 107.9 491 100.9z"/></svg>',bars:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512"><!--! Font Awesome Free 7.3.1 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free (Icons: CC BY 4.0, Fonts: SIL OFL 1.1, Code: MIT License) Copyright 2026 Fonticons, Inc. --><path d="M0 96C0 78.3 14.3 64 32 64l384 0c17.7 0 32 14.3 32 32s-14.3 32-32 32L32 128C14.3 128 0 113.7 0 96zM0 256c0-17.7 14.3-32 32-32l384 0c17.7 0 32 14.3 32 32s-14.3 32-32 32L32 288c-17.7 0-32-14.3-32-32zM448 416c0 17.7-14.3 32-32 32L32 448c-17.7 0-32-14.3-32-32s14.3-32 32-32l384 0c17.7 0 32 14.3 32 32z"/></svg>',"angles-left":'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><!--! Font Awesome Free 7.0.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2025 Fonticons, Inc. --><path d="M77.3 256 214.7 118.6c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0l-160 160c-12.5 12.5-12.5 32.8 0 45.3l160 160c12.5 12.5 32.8 12.5 45.3 0s12.5-32.8 0-45.3L77.3 256zm192 0L406.7 118.6c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0l-160 160c-12.5 12.5-12.5 32.8 0 45.3l160 160c12.5 12.5 32.8 12.5 45.3 0s12.5-32.8 0-45.3L269.3 256z"/></svg>',"angles-right":'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><!--! Font Awesome Free 7.0.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2025 Fonticons, Inc. --><path d="M434.7 256 297.3 118.6c-12.5-12.5-12.5-32.8 0-45.3s32.8-12.5 45.3 0l160 160c12.5 12.5 12.5 32.8 0 45.3l-160 160c-12.5 12.5-32.8 12.5-45.3 0s-12.5-32.8 0-45.3L434.7 256zm-192 0L105.3 118.6c-12.5-12.5-12.5-32.8 0-45.3s32.8-12.5 45.3 0l160 160c12.5 12.5 12.5 32.8 0 45.3l-160 160c-12.5 12.5-32.8 12.5-45.3 0s-12.5-32.8 0-45.3L242.7 256z"/></svg>',check:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512"><!--! Font Awesome Free 7.0.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2025 Fonticons, Inc. --><path d="M434.8 70.1c14.3 10.4 17.5 30.4 7.1 44.7l-256 352c-5.5 7.6-14 12.3-23.4 13.1s-18.5-2.7-25.1-9.3l-128-128c-12.5-12.5-12.5-32.8 0-45.3s32.8-12.5 45.3 0l101.5 101.5 234-321.7c10.4-14.3 30.4-17.5 44.7-7.1z"/></svg>',"chevron-down":'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512"><!--! Font Awesome Free 7.0.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2025 Fonticons, Inc. --><path d="M201.4 406.6c12.5 12.5 32.8 12.5 45.3 0l192-192c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0L224 338.7 54.6 169.4c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3l192 192z"/></svg>',"chevron-left":'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 512"><!--! Font Awesome Free 7.0.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2025 Fonticons, Inc. --><path d="M9.4 233.4c-12.5 12.5-12.5 32.8 0 45.3l192 192c12.5 12.5 32.8 12.5 45.3 0s12.5-32.8 0-45.3L77.3 256 246.6 86.6c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0l-192 192z"/></svg>',"chevron-right":'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 512"><!--! Font Awesome Free 7.0.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2025 Fonticons, Inc. --><path d="M311.1 233.4c12.5 12.5 12.5 32.8 0 45.3l-192 192c-12.5 12.5-32.8 12.5-45.3 0s-12.5-32.8 0-45.3L243.2 256 73.9 86.6c-12.5-12.5-12.5-32.8 0-45.3s32.8-12.5 45.3 0l192 192z"/></svg>',circle:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><!--! Font Awesome Free 7.0.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2025 Fonticons, Inc. --><path d="M0 256a256 256 0 1 1 512 0 256 256 0 1 1 -512 0z"/></svg>',"closed-captioning":'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640"><!--!Font Awesome Free v7.2.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2026 Fonticons, Inc.--><path d="M64 192C64 156.7 92.7 128 128 128L512 128C547.3 128 576 156.7 576 192L576 448C576 483.3 547.3 512 512 512L128 512C92.7 512 64 483.3 64 448L64 192zM216 272L248 272C252.4 272 256 275.6 256 280C256 293.3 266.7 304 280 304C293.3 304 304 293.3 304 280C304 249.1 278.9 224 248 224L216 224C185.1 224 160 249.1 160 280L160 360C160 390.9 185.1 416 216 416L248 416C278.9 416 304 390.9 304 360C304 346.7 293.3 336 280 336C266.7 336 256 346.7 256 360C256 364.4 252.4 368 248 368L216 368C211.6 368 208 364.4 208 360L208 280C208 275.6 211.6 272 216 272zM384 280C384 275.6 387.6 272 392 272L424 272C428.4 272 432 275.6 432 280C432 293.3 442.7 304 456 304C469.3 304 480 293.3 480 280C480 249.1 454.9 224 424 224L392 224C361.1 224 336 249.1 336 280L336 360C336 390.9 361.1 416 392 416L424 416C454.9 416 480 390.9 480 360C480 346.7 469.3 336 456 336C442.7 336 432 346.7 432 360C432 364.4 428.4 368 424 368L392 368C387.6 368 384 364.4 384 360L384 280z"/></svg>',"closed-captioning-slash":'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640"><!--!Font Awesome Free v7.2.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2026 Fonticons, Inc.--><path d="M39 39.1C48.4 29.7 63.6 29.7 72.9 39.1L161.8 128L512 128C547.3 128 576 156.7 576 192L576 448C576 473.5 561.1 495.4 539.6 505.8L601 567.1C610.4 576.5 610.4 591.7 601 601C591.6 610.3 576.4 610.4 567.1 601L39 73.1C29.7 63.7 29.7 48.5 39 39.1zM384 350.1L384 279.9C384 275.5 387.6 271.9 392 271.9L424 271.9C428.4 271.9 432 275.5 432 279.9C432 293.2 442.7 303.9 456 303.9C469.3 303.9 480 293.2 480 279.9C480 249 454.9 223.9 424 223.9L392 223.9C361.1 223.9 336 249 336 279.9L336 302.1L384 350.1zM445.5 411.6C465.7 403.2 480 383.2 480 359.9C480 346.6 469.3 335.9 456 335.9C442.7 335.9 432 346.6 432 359.9C432 364.3 428.4 367.9 424 367.9L401.8 367.9L445.5 411.6zM162.3 264.1C160.8 269.1 160 274.5 160 280L160 360C160 390.9 185.1 416 216 416L248 416C266.1 416 282.1 407.5 292.4 394.2L410.2 512L128 512C92.7 512 64 483.3 64 448L64 192C64 184.2 65.4 176.7 68 169.8L162.3 264.1zM256.1 357.9C256 358.6 256 359.3 256 360C256 364.4 252.4 368 248 368L216 368C211.6 368 208 364.4 208 360L208 309.8L256.1 357.9z"/></svg>',compress:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512"><!--!Font Awesome Free v7.2.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2026 Fonticons, Inc.--><path d="M160 64c0-17.7-14.3-32-32-32S96 46.3 96 64l0 64-64 0c-17.7 0-32 14.3-32 32s14.3 32 32 32l96 0c17.7 0 32-14.3 32-32l0-96zM32 320c-17.7 0-32 14.3-32 32s14.3 32 32 32l64 0 0 64c0 17.7 14.3 32 32 32s32-14.3 32-32l0-96c0-17.7-14.3-32-32-32l-96 0zM352 64c0-17.7-14.3-32-32-32s-32 14.3-32 32l0 96c0 17.7 14.3 32 32 32l96 0c17.7 0 32-14.3 32-32s-14.3-32-32-32l-64 0 0-64zM320 320c-17.7 0-32 14.3-32 32l0 96c0 17.7 14.3 32 32 32s32-14.3 32-32l0-64 64 0c17.7 0 32-14.3 32-32s-14.3-32-32-32l-96 0z"/></svg>',ellipsis:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640"><!--!Font Awesome Free v7.3.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2026 Fonticons, Inc.--><path d="M96 320C96 289.1 121.1 264 152 264C182.9 264 208 289.1 208 320C208 350.9 182.9 376 152 376C121.1 376 96 350.9 96 320zM264 320C264 289.1 289.1 264 320 264C350.9 264 376 289.1 376 320C376 350.9 350.9 376 320 376C289.1 376 264 350.9 264 320zM488 264C518.9 264 544 289.1 544 320C544 350.9 518.9 376 488 376C457.1 376 432 350.9 432 320C432 289.1 457.1 264 488 264z"/></svg>',"ellipsis-vertical":'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640"><!--!Font Awesome Free v7.2.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2026 Fonticons, Inc.--><path d="M320 208C289.1 208 264 182.9 264 152C264 121.1 289.1 96 320 96C350.9 96 376 121.1 376 152C376 182.9 350.9 208 320 208zM320 432C350.9 432 376 457.1 376 488C376 518.9 350.9 544 320 544C289.1 544 264 518.9 264 488C264 457.1 289.1 432 320 432zM376 320C376 350.9 350.9 376 320 376C289.1 376 264 350.9 264 320C264 289.1 289.1 264 320 264C350.9 264 376 289.1 376 320z"/></svg>',expand:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640"><!--!Font Awesome Free v7.2.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2026 Fonticons, Inc.--><path d="M128 96C110.3 96 96 110.3 96 128L96 224C96 241.7 110.3 256 128 256C145.7 256 160 241.7 160 224L160 160L224 160C241.7 160 256 145.7 256 128C256 110.3 241.7 96 224 96L128 96zM160 416C160 398.3 145.7 384 128 384C110.3 384 96 398.3 96 416L96 512C96 529.7 110.3 544 128 544L224 544C241.7 544 256 529.7 256 512C256 494.3 241.7 480 224 480L160 480L160 416zM416 96C398.3 96 384 110.3 384 128C384 145.7 398.3 160 416 160L480 160L480 224C480 241.7 494.3 256 512 256C529.7 256 544 241.7 544 224L544 128C544 110.3 529.7 96 512 96L416 96zM544 416C544 398.3 529.7 384 512 384C494.3 384 480 398.3 480 416L480 480L416 480C398.3 480 384 494.3 384 512C384 529.7 398.3 544 416 544L512 544C529.7 544 544 529.7 544 512L544 416z"/></svg>',eyedropper:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><!--! Font Awesome Free 7.0.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2025 Fonticons, Inc. --><path d="M341.6 29.2l-101.6 101.6-9.4-9.4c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3l160 160c12.5 12.5 32.8 12.5 45.3 0s12.5-32.8 0-45.3l-9.4-9.4 101.6-101.6c39-39 39-102.2 0-141.1s-102.2-39-141.1 0zM55.4 323.3c-15 15-23.4 35.4-23.4 56.6l0 42.4-26.6 39.9c-8.5 12.7-6.8 29.6 4 40.4s27.7 12.5 40.4 4l39.9-26.6 42.4 0c21.2 0 41.6-8.4 56.6-23.4l109.4-109.4-45.3-45.3-109.4 109.4c-3 3-7.1 4.7-11.3 4.7l-36.1 0 0-36.1c0-4.2 1.7-8.3 4.7-11.3l109.4-109.4-45.3-45.3-109.4 109.4z"/></svg>',filter:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><!--!Font Awesome Free v7.2.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2026 Fonticons, Inc.--><path d="M32 64C19.1 64 7.4 71.8 2.4 83.8S.2 109.5 9.4 118.6L192 301.3 192 416c0 8.5 3.4 16.6 9.4 22.6l64 64c9.2 9.2 22.9 11.9 34.9 6.9S320 492.9 320 480l0-178.7 182.6-182.6c9.2-9.2 11.9-22.9 6.9-34.9S492.9 64 480 64L32 64z"/></svg>',forward:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640"><!--!Font Awesome Free v7.2.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2026 Fonticons, Inc.--><path d="M403.7 107.1C392.1 96 375 92.9 360.3 99.2C345.6 105.5 336 120 336 136L336 272.3L163.7 107.2C152.1 96 135 92.9 120.3 99.2C105.6 105.5 96 120 96 136L96 504C96 520 105.6 534.5 120.3 540.8C135 547.1 152.1 544 163.7 532.9L336 367.7L336 504C336 520 345.6 534.5 360.3 540.8C375 547.1 392.1 544 403.7 532.9L595.7 348.9C603.6 341.4 608 330.9 608 320C608 309.1 603.5 298.7 595.7 291.1L403.7 107.1z"/></svg>',file:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640"><!--!Font Awesome Free 7.1.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2026 Fonticons, Inc.--><path d="M192 64C156.7 64 128 92.7 128 128L128 512C128 547.3 156.7 576 192 576L448 576C483.3 576 512 547.3 512 512L512 234.5C512 217.5 505.3 201.2 493.3 189.2L386.7 82.7C374.7 70.7 358.5 64 341.5 64L192 64zM453.5 240L360 240C346.7 240 336 229.3 336 216L336 122.5L453.5 240z"/></svg>',"file-audio":'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640"><!--!Font Awesome Free 7.1.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2026 Fonticons, Inc.--><path d="M128 128C128 92.7 156.7 64 192 64L341.5 64C358.5 64 374.8 70.7 386.8 82.7L493.3 189.3C505.3 201.3 512 217.6 512 234.6L512 512C512 547.3 483.3 576 448 576L192 576C156.7 576 128 547.3 128 512L128 128zM336 122.5L336 216C336 229.3 346.7 240 360 240L453.5 240L336 122.5zM389.8 307.7C380.7 301.4 368.3 303.6 362 312.7C355.7 321.8 357.9 334.2 367 340.5C390.9 357.2 406.4 384.8 406.4 416C406.4 447.2 390.8 474.9 367 491.5C357.9 497.8 355.7 510.3 362 519.3C368.3 528.3 380.8 530.6 389.8 524.3C423.9 500.5 446.4 460.8 446.4 416C446.4 371.2 424 331.5 389.8 307.7zM208 376C199.2 376 192 383.2 192 392L192 440C192 448.8 199.2 456 208 456L232 456L259.2 490C262.2 493.8 266.8 496 271.7 496L272 496C280.8 496 288 488.8 288 480L288 352C288 343.2 280.8 336 272 336L271.7 336C266.8 336 262.2 338.2 259.2 342L232 376L208 376zM336 448.2C336 458.9 346.5 466.4 354.9 459.8C367.8 449.5 376 433.7 376 416C376 398.3 367.8 382.5 354.9 372.2C346.5 365.5 336 373.1 336 383.8L336 448.3z"/></svg>',"file-code":'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640"><!--!Font Awesome Free 7.1.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2026 Fonticons, Inc.--><path d="M128 128C128 92.7 156.7 64 192 64L341.5 64C358.5 64 374.8 70.7 386.8 82.7L493.3 189.3C505.3 201.3 512 217.6 512 234.6L512 512C512 547.3 483.3 576 448 576L192 576C156.7 576 128 547.3 128 512L128 128zM336 122.5L336 216C336 229.3 346.7 240 360 240L453.5 240L336 122.5zM282.2 359.6C290.8 349.5 289.7 334.4 279.6 325.8C269.5 317.2 254.4 318.3 245.8 328.4L197.8 384.4C190.1 393.4 190.1 406.6 197.8 415.6L245.8 471.6C254.4 481.7 269.6 482.8 279.6 474.2C289.6 465.6 290.8 450.4 282.2 440.4L247.6 400L282.2 359.6zM394.2 328.4C385.6 318.3 370.4 317.2 360.4 325.8C350.4 334.4 349.2 349.6 357.8 359.6L392.4 400L357.8 440.4C349.2 450.5 350.3 465.6 360.4 474.2C370.5 482.8 385.6 481.7 394.2 471.6L442.2 415.6C449.9 406.6 449.9 393.4 442.2 384.4L394.2 328.4z"/></svg>',"file-excel":'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640"><!--!Font Awesome Free 7.1.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2026 Fonticons, Inc.--><path d="M128 128C128 92.7 156.7 64 192 64L341.5 64C358.5 64 374.8 70.7 386.8 82.7L493.3 189.3C505.3 201.3 512 217.6 512 234.6L512 512C512 547.3 483.3 576 448 576L192 576C156.7 576 128 547.3 128 512L128 128zM336 122.5L336 216C336 229.3 346.7 240 360 240L453.5 240L336 122.5zM292 330.7C284.6 319.7 269.7 316.7 258.7 324C247.7 331.3 244.7 346.3 252 357.3L291.2 416L252 474.7C244.6 485.7 247.6 500.6 258.7 508C269.8 515.4 284.6 512.4 292 501.3L320 459.3L348 501.3C355.4 512.3 370.3 515.3 381.3 508C392.3 500.7 395.3 485.7 388 474.7L348.8 416L388 357.3C395.4 346.3 392.4 331.4 381.3 324C370.2 316.6 355.4 319.6 348 330.7L320 372.7L292 330.7z"/></svg>',"file-image":'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640"><!--!Font Awesome Free 7.1.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2026 Fonticons, Inc.--><path d="M128 128C128 92.7 156.7 64 192 64L341.5 64C358.5 64 374.8 70.7 386.8 82.7L493.3 189.3C505.3 201.3 512 217.6 512 234.6L512 512C512 547.3 483.3 576 448 576L192 576C156.7 576 128 547.3 128 512L128 128zM336 122.5L336 216C336 229.3 346.7 240 360 240L453.5 240L336 122.5zM256 320C256 302.3 241.7 288 224 288C206.3 288 192 302.3 192 320C192 337.7 206.3 352 224 352C241.7 352 256 337.7 256 320zM220.6 512L419.4 512C435.2 512 448 499.2 448 483.4C448 476.1 445.2 469 440.1 463.7L343.3 361.9C337.3 355.6 328.9 352 320.1 352L319.8 352C311 352 302.7 355.6 296.6 361.9L199.9 463.7C194.8 469 192 476.1 192 483.4C192 499.2 204.8 512 220.6 512z"/></svg>',"file-pdf":'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640"><!--!Font Awesome Free 7.1.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2026 Fonticons, Inc.--><path d="M128 64C92.7 64 64 92.7 64 128L64 512C64 547.3 92.7 576 128 576L208 576L208 464C208 428.7 236.7 400 272 400L448 400L448 234.5C448 217.5 441.3 201.2 429.3 189.2L322.7 82.7C310.7 70.7 294.5 64 277.5 64L128 64zM389.5 240L296 240C282.7 240 272 229.3 272 216L272 122.5L389.5 240zM272 444C261 444 252 453 252 464L252 592C252 603 261 612 272 612C283 612 292 603 292 592L292 564L304 564C337.1 564 364 537.1 364 504C364 470.9 337.1 444 304 444L272 444zM304 524L292 524L292 484L304 484C315 484 324 493 324 504C324 515 315 524 304 524zM400 444C389 444 380 453 380 464L380 592C380 603 389 612 400 612L432 612C460.7 612 484 588.7 484 560L484 496C484 467.3 460.7 444 432 444L400 444zM420 572L420 484L432 484C438.6 484 444 489.4 444 496L444 560C444 566.6 438.6 572 432 572L420 572zM508 464L508 592C508 603 517 612 528 612C539 612 548 603 548 592L548 548L576 548C587 548 596 539 596 528C596 517 587 508 576 508L548 508L548 484L576 484C587 484 596 475 596 464C596 453 587 444 576 444L528 444C517 444 508 453 508 464z"/></svg>',"file-powerpoint":'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640"><!--!Font Awesome Free 7.1.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2026 Fonticons, Inc.--><path d="M128 128C128 92.7 156.7 64 192 64L341.5 64C358.5 64 374.8 70.7 386.8 82.7L493.3 189.3C505.3 201.3 512 217.6 512 234.6L512 512C512 547.3 483.3 576 448 576L192 576C156.7 576 128 547.3 128 512L128 128zM336 122.5L336 216C336 229.3 346.7 240 360 240L453.5 240L336 122.5zM280 320C266.7 320 256 330.7 256 344L256 488C256 501.3 266.7 512 280 512C293.3 512 304 501.3 304 488L304 464L328 464C367.8 464 400 431.8 400 392C400 352.2 367.8 320 328 320L280 320zM328 416L304 416L304 368L328 368C341.3 368 352 378.7 352 392C352 405.3 341.3 416 328 416z"/></svg>',"file-video":'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640"><!--!Font Awesome Free 7.1.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2026 Fonticons, Inc.--><path d="M128 128C128 92.7 156.7 64 192 64L341.5 64C358.5 64 374.8 70.7 386.8 82.7L493.3 189.3C505.3 201.3 512 217.6 512 234.6L512 512C512 547.3 483.3 576 448 576L192 576C156.7 576 128 547.3 128 512L128 128zM336 122.5L336 216C336 229.3 346.7 240 360 240L453.5 240L336 122.5zM208 368L208 464C208 481.7 222.3 496 240 496L336 496C353.7 496 368 481.7 368 464L368 440L403 475C406.2 478.2 410.5 480 415 480C424.4 480 432 472.4 432 463L432 368.9C432 359.5 424.4 351.9 415 351.9C410.5 351.9 406.2 353.7 403 356.9L368 391.9L368 367.9C368 350.2 353.7 335.9 336 335.9L240 335.9C222.3 335.9 208 350.2 208 367.9z"/></svg>',"file-word":'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640"><!--!Font Awesome Free 7.1.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2026 Fonticons, Inc.--><path d="M128 128C128 92.7 156.7 64 192 64L341.5 64C358.5 64 374.8 70.7 386.8 82.7L493.3 189.3C505.3 201.3 512 217.6 512 234.6L512 512C512 547.3 483.3 576 448 576L192 576C156.7 576 128 547.3 128 512L128 128zM336 122.5L336 216C336 229.3 346.7 240 360 240L453.5 240L336 122.5zM263.4 338.8C260.5 325.9 247.7 317.7 234.8 320.6C221.9 323.5 213.7 336.3 216.6 349.2L248.6 493.2C250.9 503.7 260 511.4 270.8 512C281.6 512.6 291.4 505.9 294.8 495.6L320 419.9L345.2 495.6C348.6 505.8 358.4 512.5 369.2 512C380 511.5 389.1 503.8 391.4 493.2L423.4 349.2C426.3 336.3 418.1 323.4 405.2 320.6C392.3 317.8 379.4 325.9 376.6 338.8L363.4 398.2L342.8 336.4C339.5 326.6 330.4 320 320 320C309.6 320 300.5 326.6 297.2 336.4L276.6 398.2L263.4 338.8z"/></svg>',"file-zipper":'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640"><!--!Font Awesome Free 7.1.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2026 Fonticons, Inc.--><path d="M128 128C128 92.7 156.7 64 192 64L341.5 64C358.5 64 374.8 70.7 386.8 82.7L493.3 189.3C505.3 201.3 512 217.6 512 234.6L512 512C512 547.3 483.3 576 448 576L192 576C156.7 576 128 547.3 128 512L128 128zM336 122.5L336 216C336 229.3 346.7 240 360 240L453.5 240L336 122.5zM192 136C192 149.3 202.7 160 216 160L264 160C277.3 160 288 149.3 288 136C288 122.7 277.3 112 264 112L216 112C202.7 112 192 122.7 192 136zM192 232C192 245.3 202.7 256 216 256L264 256C277.3 256 288 245.3 288 232C288 218.7 277.3 208 264 208L216 208C202.7 208 192 218.7 192 232zM256 304L224 304C206.3 304 192 318.3 192 336L192 384C192 410.5 213.5 432 240 432C266.5 432 288 410.5 288 384L288 336C288 318.3 273.7 304 256 304zM240 368C248.8 368 256 375.2 256 384C256 392.8 248.8 400 240 400C231.2 400 224 392.8 224 384C224 375.2 231.2 368 240 368z"/></svg>',"forward-step":'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 384 512"><!--!Font Awesome Free v7.2.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2026 Fonticons, Inc.--><path d="M21 36.8c12.9-7 28.7-6.3 41 1.8L320 208.1 320 64c0-17.7 14.3-32 32-32s32 14.3 32 32l0 384c0 17.7-14.3 32-32 32s-32-14.3-32-32l0-144.1-258 169.6c-12.3 8.1-28 8.8-41 1.8S0 454.7 0 440L0 72C0 57.3 8.1 43.8 21 36.8z"/></svg>',gauge:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><!--!Font Awesome Free v7.2.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2026 Fonticons, Inc.--><path d="M0 256a256 256 0 1 1 512 0 256 256 0 1 1 -512 0zm320 96c0-26.9-16.5-49.9-40-59.3L280 120c0-13.3-10.7-24-24-24s-24 10.7-24 24l0 172.7c-23.5 9.5-40 32.5-40 59.3 0 35.3 28.7 64 64 64s64-28.7 64-64zM144 176a32 32 0 1 0 0-64 32 32 0 1 0 0 64zm-16 80a32 32 0 1 0 -64 0 32 32 0 1 0 64 0zm288 32a32 32 0 1 0 0-64 32 32 0 1 0 0 64zM400 144a32 32 0 1 0 -64 0 32 32 0 1 0 64 0z"/></svg>',gear:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640"><!--!Font Awesome Free v7.2.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2026 Fonticons, Inc.--><path d="M259.1 73.5C262.1 58.7 275.2 48 290.4 48L350.2 48C365.4 48 378.5 58.7 381.5 73.5L396 143.5C410.1 149.5 423.3 157.2 435.3 166.3L503.1 143.8C517.5 139 533.3 145 540.9 158.2L570.8 210C578.4 223.2 575.7 239.8 564.3 249.9L511 297.3C511.9 304.7 512.3 312.3 512.3 320C512.3 327.7 511.8 335.3 511 342.7L564.4 390.2C575.8 400.3 578.4 417 570.9 430.1L541 481.9C533.4 495 517.6 501.1 503.2 496.3L435.4 473.8C423.3 482.9 410.1 490.5 396.1 496.6L381.7 566.5C378.6 581.4 365.5 592 350.4 592L290.6 592C275.4 592 262.3 581.3 259.3 566.5L244.9 496.6C230.8 490.6 217.7 482.9 205.6 473.8L137.5 496.3C123.1 501.1 107.3 495.1 99.7 481.9L69.8 430.1C62.2 416.9 64.9 400.3 76.3 390.2L129.7 342.7C128.8 335.3 128.4 327.7 128.4 320C128.4 312.3 128.9 304.7 129.7 297.3L76.3 249.8C64.9 239.7 62.3 223 69.8 209.9L99.7 158.1C107.3 144.9 123.1 138.9 137.5 143.7L205.3 166.2C217.4 157.1 230.6 149.5 244.6 143.4L259.1 73.5zM320.3 400C364.5 399.8 400.2 363.9 400 319.7C399.8 275.5 363.9 239.8 319.7 240C275.5 240.2 239.8 276.1 240 320.3C240.2 364.5 276.1 400.2 320.3 400z"/></svg>',"grip-vertical":'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 512"><!--! Font Awesome Free 7.0.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2025 Fonticons, Inc. --><path d="M128 40c0-22.1-17.9-40-40-40L40 0C17.9 0 0 17.9 0 40L0 88c0 22.1 17.9 40 40 40l48 0c22.1 0 40-17.9 40-40l0-48zm0 192c0-22.1-17.9-40-40-40l-48 0c-22.1 0-40 17.9-40 40l0 48c0 22.1 17.9 40 40 40l48 0c22.1 0 40-17.9 40-40l0-48zM0 424l0 48c0 22.1 17.9 40 40 40l48 0c22.1 0 40-17.9 40-40l0-48c0-22.1-17.9-40-40-40l-48 0c-22.1 0-40 17.9-40 40zM320 40c0-22.1-17.9-40-40-40L232 0c-22.1 0-40 17.9-40 40l0 48c0 22.1 17.9 40 40 40l48 0c22.1 0 40-17.9 40-40l0-48zM192 232l0 48c0 22.1 17.9 40 40 40l48 0c22.1 0 40-17.9 40-40l0-48c0-22.1-17.9-40-40-40l-48 0c-22.1 0-40 17.9-40 40zM320 424c0-22.1-17.9-40-40-40l-48 0c-22.1 0-40 17.9-40 40l0 48c0 22.1 17.9 40 40 40l48 0c22.1 0 40-17.9 40-40l0-48z"/></svg>',indeterminate:'<svg part="indeterminate-icon" class="icon" viewBox="0 0 16 16"><g stroke="none" stroke-width="1" fill="none" fill-rule="evenodd" stroke-linecap="round"><g stroke="currentColor" stroke-width="2"><g transform="translate(2.285714 6.857143)"><path d="M10.2857143,1.14285714 L1.14285714,1.14285714"/></g></g></g></svg>',"magnifying-glass":'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><!--!Font Awesome Free v7.2.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2026 Fonticons, Inc.--><path d="M416 208c0 45.9-14.9 88.3-40 122.7L502.6 457.4c12.5 12.5 12.5 32.8 0 45.3s-32.8 12.5-45.3 0L330.7 376C296.3 401.1 253.9 416 208 416 93.1 416 0 322.9 0 208S93.1 0 208 0 416 93.1 416 208zM208 352a144 144 0 1 0 0-288 144 144 0 1 0 0 288z"/></svg>',minus:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512"><!--! Font Awesome Free 7.0.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2025 Fonticons, Inc. --><path d="M0 256c0-17.7 14.3-32 32-32l384 0c17.7 0 32 14.3 32 32s-14.3 32-32 32L32 288c-17.7 0-32-14.3-32-32z"/></svg>',pause:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 384 512"><!--! Font Awesome Free 7.0.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2025 Fonticons, Inc. --><path d="M48 32C21.5 32 0 53.5 0 80L0 432c0 26.5 21.5 48 48 48l64 0c26.5 0 48-21.5 48-48l0-352c0-26.5-21.5-48-48-48L48 32zm224 0c-26.5 0-48 21.5-48 48l0 352c0 26.5 21.5 48 48 48l64 0c26.5 0 48-21.5 48-48l0-352c0-26.5-21.5-48-48-48l-64 0z"/></svg>',"picture-in-picture":'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><!--!Font Awesome Free v7.2.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2026 Fonticons, Inc.--><path d="M448 32c35.3 0 64 28.7 64 64l0 112-64 0 0-112-384 0 0 320 144 0 0 64-144 0-6.5-.3c-30.1-3.1-54.1-27-57.1-57.1L0 416 0 96C0 62.9 25.2 35.6 57.5 32.3L64 32 448 32zm16 224c26.5 0 48 21.5 48 48l0 128c0 26.5-21.5 48-48 48l-160 0c-26.5 0-48-21.5-48-48l0-128c0-26.5 21.5-48 48-48l160 0z"/></svg>',play:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512"><!--! Font Awesome Free 7.0.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2025 Fonticons, Inc. --><path d="M91.2 36.9c-12.4-6.8-27.4-6.5-39.6 .7S32 57.9 32 72l0 368c0 14.1 7.5 27.2 19.6 34.4s27.2 7.5 39.6 .7l336-184c12.8-7 20.8-20.5 20.8-35.1s-8-28.1-20.8-35.1l-336-184z"/></svg>',"play-circle":'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><!--!Font Awesome Free v7.2.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2026 Fonticons, Inc.--><path d="M0 256a256 256 0 1 1 512 0 256 256 0 1 1 -512 0zM188.3 147.1c-7.6 4.2-12.3 12.3-12.3 20.9l0 176c0 8.7 4.7 16.7 12.3 20.9s16.8 4.1 24.3-.5l144-88c7.1-4.4 11.5-12.1 11.5-20.5s-4.4-16.1-11.5-20.5l-144-88c-7.4-4.5-16.7-4.7-24.3-.5z"/></svg>',plus:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640"><!--!Font Awesome Free 7.1.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2026 Fonticons, Inc.--><path d="M352 128C352 110.3 337.7 96 320 96C302.3 96 288 110.3 288 128L288 288L128 288C110.3 288 96 302.3 96 320C96 337.7 110.3 352 128 352L288 352L288 512C288 529.7 302.3 544 320 544C337.7 544 352 529.7 352 512L352 352L512 352C529.7 352 544 337.7 544 320C544 302.3 529.7 288 512 288L352 288L352 128z"/></svg>',star:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 576 512"><!--! Font Awesome Free 7.0.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2025 Fonticons, Inc. --><path d="M309.5-18.9c-4.1-8-12.4-13.1-21.4-13.1s-17.3 5.1-21.4 13.1L193.1 125.3 33.2 150.7c-8.9 1.4-16.3 7.7-19.1 16.3s-.5 18 5.8 24.4l114.4 114.5-25.2 159.9c-1.4 8.9 2.3 17.9 9.6 23.2s16.9 6.1 25 2L288.1 417.6 432.4 491c8 4.1 17.7 3.3 25-2s11-14.2 9.6-23.2L441.7 305.9 556.1 191.4c6.4-6.4 8.6-15.8 5.8-24.4s-10.1-14.9-19.1-16.3L383 125.3 309.5-18.9z"/></svg>',"table-columns":'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512"><!--!Font Awesome Free v7.2.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2026 Fonticons, Inc.--><path d="M0 96C0 60.7 28.7 32 64 32l320 0c35.3 0 64 28.7 64 64l0 320c0 35.3-28.7 64-64 64L64 480c-35.3 0-64-28.7-64-64L0 96zm64 64l0 256 128 0 0-256-128 0zm320 0l-128 0 0 256 128 0 0-256z"/></svg>',thumbtack:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 384 512"><!--!Font Awesome Free v7.2.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2026 Fonticons, Inc.--><path d="M32 32C32 14.3 46.3 0 64 0L320 0c17.7 0 32 14.3 32 32s-14.3 32-32 32l-29.5 0 10.3 134.1c37.1 21.2 65.8 56.4 78.2 99.7l3.8 13.4c2.8 9.7 .8 20-5.2 28.1S362 352 352 352L32 352c-10 0-19.5-4.7-25.5-12.7s-8-18.4-5.2-28.1L5 297.8c12.4-43.3 41-78.5 78.2-99.7L93.5 64 64 64C46.3 64 32 49.7 32 32zM160 400l64 0 0 112c0 17.7-14.3 32-32 32s-32-14.3-32-32l0-112z"/></svg>',"up-down":'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><!--!Font Awesome Free v7.2.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2026 Fonticons, Inc.--><path d="M406.6 502.6l96-96c9.2-9.2 11.9-22.9 6.9-34.9S492.9 352 480 352l-64 0 0-320c0-17.7-14.3-32-32-32s-32 14.3-32 32l0 320-64 0c-12.9 0-24.6 7.8-29.6 19.8s-2.2 25.7 6.9 34.9l96 96c12.5 12.5 32.8 12.5 45.3 0zM150.6 9.4c-12.5-12.5-32.8-12.5-45.3 0l-96 96c-9.2 9.2-11.9 22.9-6.9 34.9S19.1 160 32 160l64 0 0 320c0 17.7 14.3 32 32 32s32-14.3 32-32l0-320 64 0c12.9 0 24.6-7.8 29.6-19.8s2.2-25.7-6.9-34.9l-96-96z"/></svg>',upload:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640"><!--!Font Awesome Free 7.1.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2026 Fonticons, Inc.--><path d="M352 173.3L352 384C352 401.7 337.7 416 320 416C302.3 416 288 401.7 288 384L288 173.3L246.6 214.7C234.1 227.2 213.8 227.2 201.3 214.7C188.8 202.2 188.8 181.9 201.3 169.4L297.3 73.4C309.8 60.9 330.1 60.9 342.6 73.4L438.6 169.4C451.1 181.9 451.1 202.2 438.6 214.7C426.1 227.2 405.8 227.2 393.3 214.7L352 173.3zM320 464C364.2 464 400 428.2 400 384L480 384C515.3 384 544 412.7 544 448L544 480C544 515.3 515.3 544 480 544L160 544C124.7 544 96 515.3 96 480L96 448C96 412.7 124.7 384 160 384L240 384C240 428.2 275.8 464 320 464zM464 488C477.3 488 488 477.3 488 464C488 450.7 477.3 440 464 440C450.7 440 440 450.7 440 464C440 477.3 450.7 488 464 488z"/></svg>',user:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512"><!--! Font Awesome Free 7.0.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2025 Fonticons, Inc. --><path d="M224 248a120 120 0 1 0 0-240 120 120 0 1 0 0 240zm-29.7 56C95.8 304 16 383.8 16 482.3 16 498.7 29.3 512 45.7 512l356.6 0c16.4 0 29.7-13.3 29.7-29.7 0-98.5-79.8-178.3-178.3-178.3l-59.4 0z"/></svg>',volume:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><!--!Font Awesome Free v7.2.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2026 Fonticons, Inc.--><path d="M48 352l48 0 134.1 119.2c6.4 5.7 14.6 8.8 23.1 8.8 19.2 0 34.8-15.6 34.8-34.8l0-378.4c0-19.2-15.6-34.8-34.8-34.8-8.5 0-16.7 3.1-23.1 8.8L96 160 48 160c-26.5 0-48 21.5-48 48l0 96c0 26.5 21.5 48 48 48zM441.1 107c-10.3-8.4-25.4-6.8-33.8 3.5s-6.8 25.4 3.5 33.8C443.3 170.7 464 210.9 464 256s-20.7 85.3-53.2 111.8c-10.3 8.4-11.8 23.5-3.5 33.8s23.5 11.8 33.8 3.5c43.2-35.2 70.9-88.9 70.9-149s-27.7-113.8-70.9-149zm-60.5 74.5c-10.3-8.4-25.4-6.8-33.8 3.5s-6.8 25.4 3.5 33.8C361.1 227.6 368 241 368 256s-6.9 28.4-17.7 37.3c-10.3 8.4-11.8 23.5-3.5 33.8s23.5 11.8 33.8 3.5C402.1 312.9 416 286.1 416 256s-13.9-56.9-35.5-74.5z"/></svg>',"volume-low":'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512"><!--!Font Awesome Free v7.2.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2026 Fonticons, Inc.--><path d="M48 352l48 0 134.1 119.2c6.4 5.7 14.6 8.8 23.1 8.8 19.2 0 34.8-15.6 34.8-34.8l0-378.4c0-19.2-15.6-34.8-34.8-34.8-8.5 0-16.7 3.1-23.1 8.8L96 160 48 160c-26.5 0-48 21.5-48 48l0 96c0 26.5 21.5 48 48 48zM380.6 181.5c-10.3-8.4-25.4-6.8-33.8 3.5s-6.8 25.4 3.5 33.8C361.1 227.6 368 241 368 256s-6.9 28.4-17.7 37.3c-10.3 8.4-11.8 23.5-3.5 33.8s23.5 11.8 33.8 3.5C402.1 312.9 416 286.1 416 256s-13.9-56.9-35.5-74.5z"/></svg>',"volume-xmark":'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 576 512"><!--!Font Awesome Free v7.2.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2026 Fonticons, Inc.--><path d="M48 352l48 0 134.1 119.2c6.4 5.7 14.6 8.8 23.1 8.8 19.2 0 34.8-15.6 34.8-34.8l0-378.4c0-19.2-15.6-34.8-34.8-34.8-8.5 0-16.7 3.1-23.1 8.8L96 160 48 160c-26.5 0-48 21.5-48 48l0 96c0 26.5 21.5 48 48 48zM367 175c-9.4 9.4-9.4 24.6 0 33.9l47 47-47 47c-9.4 9.4-9.4 24.6 0 33.9s24.6 9.4 33.9 0l47-47 47 47c9.4 9.4 24.6 9.4 33.9 0s9.4-24.6 0-33.9l-47-47 47-47c9.4-9.4 9.4-24.6 0-33.9s-24.6-9.4-33.9 0l-47 47-47-47c-9.4-9.4-24.6-9.4-33.9 0z"/></svg>',xmark:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 384 512"><!--! Font Awesome Free 7.0.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2025 Fonticons, Inc. --><path d="M55.1 73.4c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3L147.2 256 9.9 393.4c-12.5 12.5-12.5 32.8 0 45.3s32.8 12.5 45.3 0L192.5 301.3 329.9 438.6c12.5 12.5 32.8 12.5 45.3 0s12.5-32.8 0-45.3L237.8 256 375.1 118.6c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0L192.5 210.7 55.1 73.4z"/></svg>'},regular:{calendar:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640"><!--!Font Awesome Free v7.2.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2026 Fonticons, Inc.--><path d="M216 64C229.3 64 240 74.7 240 88L240 128L400 128L400 88C400 74.7 410.7 64 424 64C437.3 64 448 74.7 448 88L448 128L480 128C515.3 128 544 156.7 544 192L544 480C544 515.3 515.3 544 480 544L160 544C124.7 544 96 515.3 96 480L96 192C96 156.7 124.7 128 160 128L192 128L192 88C192 74.7 202.7 64 216 64zM216 176L160 176C151.2 176 144 183.2 144 192L144 240L496 240L496 192C496 183.2 488.8 176 480 176L216 176zM144 288L144 480C144 488.8 151.2 496 160 496L480 496C488.8 496 496 488.8 496 480L496 288L144 288z"/></svg>',"circle-question":'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><!--! Font Awesome Free 7.0.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2025 Fonticons, Inc. --><path d="M464 256a208 208 0 1 0 -416 0 208 208 0 1 0 416 0zM0 256a256 256 0 1 1 512 0 256 256 0 1 1 -512 0zm256-80c-17.7 0-32 14.3-32 32 0 13.3-10.7 24-24 24s-24-10.7-24-24c0-44.2 35.8-80 80-80s80 35.8 80 80c0 47.2-36 67.2-56 74.5l0 3.8c0 13.3-10.7 24-24 24s-24-10.7-24-24l0-8.1c0-20.5 14.8-35.2 30.1-40.2 6.4-2.1 13.2-5.5 18.2-10.3 4.3-4.2 7.7-10 7.7-19.6 0-17.7-14.3-32-32-32zM224 368a32 32 0 1 1 64 0 32 32 0 1 1 -64 0z"/></svg>',"circle-xmark":'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><!--! Font Awesome Free 7.0.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2025 Fonticons, Inc. --><path d="M256 48a208 208 0 1 1 0 416 208 208 0 1 1 0-416zm0 464a256 256 0 1 0 0-512 256 256 0 1 0 0 512zM167 167c-9.4 9.4-9.4 24.6 0 33.9l55 55-55 55c-9.4 9.4-9.4 24.6 0 33.9s24.6 9.4 33.9 0l55-55 55 55c9.4 9.4 24.6 9.4 33.9 0s9.4-24.6 0-33.9l-55-55 55-55c9.4-9.4 9.4-24.6 0-33.9s-24.6-9.4-33.9 0l-55 55-55-55c-9.4-9.4-24.6-9.4-33.9 0z"/></svg>',clock:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640"><!--!Font Awesome Free v7.2.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2026 Fonticons, Inc.--><path d="M528 320C528 434.9 434.9 528 320 528C205.1 528 112 434.9 112 320C112 205.1 205.1 112 320 112C434.9 112 528 205.1 528 320zM64 320C64 461.4 178.6 576 320 576C461.4 576 576 461.4 576 320C576 178.6 461.4 64 320 64C178.6 64 64 178.6 64 320zM296 184L296 320C296 328 300 335.5 306.7 340L402.7 404C413.7 411.4 428.6 408.4 436 397.3C443.4 386.2 440.4 371.4 429.3 364L344 307.2L344 184C344 170.7 333.3 160 320 160C306.7 160 296 170.7 296 184z"/></svg>',copy:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512"><!--! Font Awesome Free 7.0.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2025 Fonticons, Inc. --><path d="M384 336l-192 0c-8.8 0-16-7.2-16-16l0-256c0-8.8 7.2-16 16-16l133.5 0c4.2 0 8.3 1.7 11.3 4.7l58.5 58.5c3 3 4.7 7.1 4.7 11.3L400 320c0 8.8-7.2 16-16 16zM192 384l192 0c35.3 0 64-28.7 64-64l0-197.5c0-17-6.7-33.3-18.7-45.3L370.7 18.7C358.7 6.7 342.5 0 325.5 0L192 0c-35.3 0-64 28.7-64 64l0 256c0 35.3 28.7 64 64 64zM64 128c-35.3 0-64 28.7-64 64L0 448c0 35.3 28.7 64 64 64l192 0c35.3 0 64-28.7 64-64l0-16-48 0 0 16c0 8.8-7.2 16-16 16L64 464c-8.8 0-16-7.2-16-16l0-256c0-8.8 7.2-16 16-16l16 0 0-48-16 0z"/></svg>',eye:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 576 512"><!--! Font Awesome Free 7.0.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2025 Fonticons, Inc. --><path d="M288 80C222.8 80 169.2 109.6 128.1 147.7 89.6 183.5 63 226 49.4 256 63 286 89.6 328.5 128.1 364.3 169.2 402.4 222.8 432 288 432s118.8-29.6 159.9-67.7C486.4 328.5 513 286 526.6 256 513 226 486.4 183.5 447.9 147.7 406.8 109.6 353.2 80 288 80zM95.4 112.6C142.5 68.8 207.2 32 288 32s145.5 36.8 192.6 80.6c46.8 43.5 78.1 95.4 93 131.1 3.3 7.9 3.3 16.7 0 24.6-14.9 35.7-46.2 87.7-93 131.1-47.1 43.7-111.8 80.6-192.6 80.6S142.5 443.2 95.4 399.4c-46.8-43.5-78.1-95.4-93-131.1-3.3-7.9-3.3-16.7 0-24.6 14.9-35.7 46.2-87.7 93-131.1zM288 336c44.2 0 80-35.8 80-80 0-29.6-16.1-55.5-40-69.3-1.4 59.7-49.6 107.9-109.3 109.3 13.8 23.9 39.7 40 69.3 40zm-79.6-88.4c2.5 .3 5 .4 7.6 .4 35.3 0 64-28.7 64-64 0-2.6-.2-5.1-.4-7.6-37.4 3.9-67.2 33.7-71.1 71.1zm45.6-115c10.8-3 22.2-4.5 33.9-4.5 8.8 0 17.5 .9 25.8 2.6 .3 .1 .5 .1 .8 .2 57.9 12.2 101.4 63.7 101.4 125.2 0 70.7-57.3 128-128 128-61.6 0-113-43.5-125.2-101.4-1.8-8.6-2.8-17.5-2.8-26.6 0-11 1.4-21.8 4-32 .2-.7 .3-1.3 .5-1.9 11.9-43.4 46.1-77.6 89.5-89.5z"/></svg>',"eye-slash":'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 576 512"><!--! Font Awesome Free 7.0.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2025 Fonticons, Inc. --><path d="M41-24.9c-9.4-9.4-24.6-9.4-33.9 0S-2.3-.3 7 9.1l528 528c9.4 9.4 24.6 9.4 33.9 0s9.4-24.6 0-33.9l-96.4-96.4c2.7-2.4 5.4-4.8 8-7.2 46.8-43.5 78.1-95.4 93-131.1 3.3-7.9 3.3-16.7 0-24.6-14.9-35.7-46.2-87.7-93-131.1-47.1-43.7-111.8-80.6-192.6-80.6-56.8 0-105.6 18.2-146 44.2L41-24.9zM176.9 111.1c32.1-18.9 69.2-31.1 111.1-31.1 65.2 0 118.8 29.6 159.9 67.7 38.5 35.7 65.1 78.3 78.6 108.3-13.6 30-40.2 72.5-78.6 108.3-3.1 2.8-6.2 5.6-9.4 8.4L393.8 328c14-20.5 22.2-45.3 22.2-72 0-70.7-57.3-128-128-128-26.7 0-51.5 8.2-72 22.2l-39.1-39.1zm182 182l-108-108c11.1-5.8 23.7-9.1 37.1-9.1 44.2 0 80 35.8 80 80 0 13.4-3.3 26-9.1 37.1zM103.4 173.2l-34-34c-32.6 36.8-55 75.8-66.9 104.5-3.3 7.9-3.3 16.7 0 24.6 14.9 35.7 46.2 87.7 93 131.1 47.1 43.7 111.8 80.6 192.6 80.6 37.3 0 71.2-7.9 101.5-20.6L352.2 422c-20 6.4-41.4 10-64.2 10-65.2 0-118.8-29.6-159.9-67.7-38.5-35.7-65.1-78.3-78.6-108.3 10.4-23.1 28.6-53.6 54-82.8z"/></svg>',star:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 576 512"><!--! Font Awesome Free 7.0.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2025 Fonticons, Inc. --><path d="M288.1-32c9 0 17.3 5.1 21.4 13.1L383 125.3 542.9 150.7c8.9 1.4 16.3 7.7 19.1 16.3s.5 18-5.8 24.4L441.7 305.9 467 465.8c1.4 8.9-2.3 17.9-9.6 23.2s-17 6.1-25 2L288.1 417.6 143.8 491c-8 4.1-17.7 3.3-25-2s-11-14.2-9.6-23.2L134.4 305.9 20 191.4c-6.4-6.4-8.6-15.8-5.8-24.4s10.1-14.9 19.1-16.3l159.9-25.4 73.6-144.2c4.1-8 12.4-13.1 21.4-13.1zm0 76.8L230.3 158c-3.5 6.8-10 11.6-17.6 12.8l-125.5 20 89.8 89.9c5.4 5.4 7.9 13.1 6.7 20.7l-19.8 125.5 113.3-57.6c6.8-3.5 14.9-3.5 21.8 0l113.3 57.6-19.8-125.5c-1.2-7.6 1.3-15.3 6.7-20.7l89.8-89.9-125.5-20c-7.6-1.2-14.1-6-17.6-12.8L288.1 44.8z"/></svg>'}},U4={name:"system",resolver:(o,a="classic",n="solid")=>{let i=_2[n][o]??_2.regular[o]??_2.regular["circle-question"];if(i)return Y4(i);return""},mutator:(o)=>{if(!o.hasAttribute("fill"))o.setAttribute("fill","currentColor")}},l1=U4;/*! Copyright 2026 Fonticons, Inc. - https://webawesome.com/license */var Z4="classic",J4=[w1,l1],u1=new Set;function m1(o){u1.add(o)}function g1(o){u1.delete(o)}function d2(o){return J4.find((a)=>a.name===o)}function b1(){return Z4}var h1=(o,a)=>a===void 0?o?._$litType$!==void 0:o?._$litType$===a;/*! Copyright 2026 Fonticons, Inc. - https://webawesome.com/license */var Po=Symbol(),p2=Symbol(),o0,a0=new Map,Z=class extends ${constructor(){super(...arguments);this.svg=null,this.autoWidth=!1,this.swapOpacity=!1,this.label="",this.library="default",this.rotate=0,this.resolveIcon=async(o,a)=>{let n;if(a?.spriteSheet){if(!this.hasUpdated)await this.updateComplete;this.svg=M`<svg part="svg">
        <use part="use" href="${o}"></use>
      </svg>`,await this.updateComplete;let r=this.shadowRoot.querySelector("[part='svg']");if(typeof a.mutator==="function")a.mutator(r,this);return this.svg}try{if(n=await fetch(o,{mode:"cors"}),!n.ok)return n.status===410?Po:p2}catch{return p2}try{let r=document.createElement("div");r.innerHTML=await n.text();let i=r.firstElementChild;if(i?.tagName?.toLowerCase()!=="svg")return Po;if(!o0)o0=new DOMParser;let t=o0.parseFromString(i.outerHTML,"text/html").body.querySelector("svg");if(!t)return Po;return t.part.add("svg"),document.adoptNode(t)}catch{return Po}}}connectedCallback(){super.connectedCallback(),m1(this)}firstUpdated(o){if(super.firstUpdated(o),this.hasAttribute("rotate"))this.style.setProperty("--rotate-angle",`${this.rotate}deg`);this.setIcon()}disconnectedCallback(){super.disconnectedCallback(),g1(this)}async getIconSource(){let o=d2(this.library),a=this.family||b1();if(this.name&&o){let n=this.canvas==="auto"||this.autoWidth,r;try{r=await o.resolver(this.name,a,this.variant,n)}catch{r=void 0}return{url:r,fromLibrary:!0}}return{url:this.src,fromLibrary:!1}}handleLabelChange(){if(typeof this.label==="string"&&this.label.length>0)this.setAttribute("role","img"),this.setAttribute("aria-label",this.label),this.removeAttribute("aria-hidden");else this.removeAttribute("role"),this.removeAttribute("aria-label"),this.setAttribute("aria-hidden","true")}async setIcon(){let{url:o,fromLibrary:a}=await this.getIconSource(),n=a?d2(this.library):void 0;if(!o){this.svg=null;return}let r=a0.get(o);if(!r)r=this.resolveIcon(o,n),a0.set(o,r);let i=await r;if(i===p2)a0.delete(o);let c=await this.getIconSource();if(o!==c.url)return;if(h1(i)){this.svg=i;return}switch(i){case p2:case Po:this.svg=null,this.dispatchEvent(new n1);break;default:this.svg=i.cloneNode(!0),n?.mutator?.(this.svg,this),this.dispatchEvent(new r1)}}willUpdate(o){if(!this.style)this.setStyleProperty("--rotate-angle",`${this.rotate}deg`);return super.willUpdate(o)}updated(o){super.updated(o);let a=d2(this.library);if(this.hasAttribute("rotate"))this.style.setProperty("--rotate-angle",`${this.rotate}deg`);let n=this.shadowRoot?.querySelector("svg");if(n)a?.mutator?.(n,this)}render(){if(this.hasUpdated)return this.svg;return M`<svg part="svg" width="16" height="16" viewBox="0 0 16 16"></svg>`}};Z.css=i1;w([Fo()],Z.prototype,"svg",2);w([g({reflect:!0})],Z.prototype,"name",2);w([g({reflect:!0})],Z.prototype,"family",2);w([g({reflect:!0})],Z.prototype,"variant",2);w([g({reflect:!0})],Z.prototype,"canvas",2);w([g({attribute:"auto-width",type:Boolean,reflect:!0})],Z.prototype,"autoWidth",2);w([g({attribute:"swap-opacity",type:Boolean,reflect:!0})],Z.prototype,"swapOpacity",2);w([g()],Z.prototype,"src",2);w([g()],Z.prototype,"label",2);w([g({reflect:!0})],Z.prototype,"library",2);w([g({type:Number,reflect:!0})],Z.prototype,"rotate",2);w([g({type:String,reflect:!0})],Z.prototype,"flip",2);w([g({type:String,reflect:!0})],Z.prototype,"animation",2);w([B("label")],Z.prototype,"handleLabelChange",1);w([B(["family","name","library","variant","src","autoWidth","canvas","swapOpacity"],{waitUntilFirstUpdate:!0})],Z.prototype,"setIcon",1);Z=w([Y("wa-icon")],Z);/*! Copyright 2026 Fonticons, Inc. - https://webawesome.com/license *//*! Copyright 2026 Fonticons, Inc. - https://webawesome.com/license */var v1=class{constructor(o,a){this.element=o,this.callback=a}start(...o){if(P)return;this.observer??(this.observer=new ResizeObserver(()=>this.check())),this.observer.observe(this.element);for(let a of o)this.observer.observe(a);this.initialCheckHandle??(this.initialCheckHandle=requestAnimationFrame(()=>{this.initialCheckHandle=void 0,this.check()}))}stop(){if(this.initialCheckHandle!==void 0)cancelAnimationFrame(this.initialCheckHandle),this.initialCheckHandle=void 0;this.observer?.disconnect()}check(){this.callback(this.element.getClientRects().length>0)}};/*! Copyright 2026 Fonticons, Inc. - https://webawesome.com/license */function f1(o,a){let n=a.getBoundingClientRect();return o.clientX>=n.left&&o.clientX<=n.right&&o.clientY>=n.top&&o.clientY<=n.bottom}var n0=new Set;function B4(){let o=document.documentElement.clientWidth;return Math.abs(window.innerWidth-o)}function Q4(){let o=Number(getComputedStyle(document.body).paddingRight.replace(/px/,""));if(isNaN(o)||!o)return 0;return o}function z2(o){if(n0.add(o),!document.documentElement.classList.contains("wa-scroll-lock")){let a=B4()+Q4(),n=getComputedStyle(document.documentElement).scrollbarGutter;if(!n||n==="auto")n="stable";if(a<2)n="";document.documentElement.style.setProperty("--wa-scroll-lock-gutter",n),document.documentElement.classList.add("wa-scroll-lock"),document.documentElement.style.setProperty("--wa-scroll-lock-size",`${a}px`)}}function L2(o){if(n0.delete(o),n0.size===0)document.documentElement.classList.remove("wa-scroll-lock"),document.documentElement.style.removeProperty("--wa-scroll-lock-size")}/*! Copyright 2026 Fonticons, Inc. - https://webawesome.com/license */function d1(o){return o.split(" ").map((a)=>a.trim()).filter((a)=>a!=="")}/*! Copyright 2026 Fonticons, Inc. - https://webawesome.com/license */var C2=class extends Event{constructor(){super("wa-show",{bubbles:!0,cancelable:!0,composed:!0})}};/*! Copyright 2026 Fonticons, Inc. - https://webawesome.com/license */var x2=class extends Event{constructor(o){super("wa-hide",{bubbles:!0,cancelable:!0,composed:!0});this.detail=o}};/*! Copyright 2026 Fonticons, Inc. - https://webawesome.com/license */var F2=class extends Event{constructor(){super("wa-after-hide",{bubbles:!0,cancelable:!1,composed:!0})}};/*! Copyright 2026 Fonticons, Inc. - https://webawesome.com/license */var y2=class extends Event{constructor(){super("wa-after-show",{bubbles:!0,cancelable:!1,composed:!0})}};/*! Copyright 2026 Fonticons, Inc. - https://webawesome.com/license */var p1=y`
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
`;/*! Copyright 2026 Fonticons, Inc. - https://webawesome.com/license */var qo=[];function M2(o){Xo(o),qo.push(o)}function Xo(o){for(let a=qo.length-1;a>=0;a--)if(qo[a]===o){qo.splice(a,1);break}}function Ro(o){return qo.length>0&&qo[qo.length-1]===o}/*! Copyright 2026 Fonticons, Inc. - https://webawesome.com/license */function E(o,a){return new Promise((n)=>{let r=new AbortController,{signal:i}=r;if(o.classList.contains(a))return;o.classList.add(a);let c=!1,t=()=>{if(c)return;c=!0,o.classList.remove(a),n(),r.abort()};o.addEventListener("animationend",t,{once:!0,signal:i}),o.addEventListener("animationcancel",t,{once:!0,signal:i}),requestAnimationFrame(()=>{if(!c&&o.getAnimations().length===0)t()})})}/*! Copyright 2026 Fonticons, Inc. - https://webawesome.com/license */var H=class extends ${constructor(){super(...arguments);this.localize=new _(this),this.hasSlotController=new go(this,"footer","header-actions","label"),this.renderedWatcher=new v1(this,(o)=>this.handleRenderedChange(o)),this.open=!1,this.label="",this.withoutHeader=!1,this.lightDismiss=!1,this.withFooter=!1,this.withLabel=!1,this.handleDocumentKeyDown=(o)=>{if(o.key==="Escape"&&this.open&&Ro(this))o.preventDefault(),o.stopPropagation(),this.requestClose(this.dialog)}}firstUpdated(o){if(super.firstUpdated(o),this.open)this.addOpenListeners(),this.dialog.showModal(),z2(this),this.renderedWatcher.start(this.dialog)}disconnectedCallback(){super.disconnectedCallback(),this.renderedWatcher.stop(),L2(this),this.removeOpenListeners()}async requestClose(o){let a=new x2({source:o});if(this.dispatchEvent(a),a.defaultPrevented){this.open=!0,E(this.dialog,"pulse");return}this.removeOpenListeners(),await E(this.dialog,"hide"),this.open=!1,this.dialog.close(),L2(this),this.renderedWatcher.stop();let n=this.originalTrigger;if(typeof n?.focus==="function")setTimeout(()=>n.focus());this.dispatchEvent(new F2)}addOpenListeners(){document.addEventListener("keydown",this.handleDocumentKeyDown),M2(this)}removeOpenListeners(){document.removeEventListener("keydown",this.handleDocumentKeyDown),Xo(this)}handleDialogCancel(o){if(o.preventDefault(),!this.dialog.classList.contains("hide")&&o.target===this.dialog&&Ro(this))this.requestClose(this.dialog)}handleDialogClick(o){let n=o.target.closest('[data-dialog="close"]');if(n)o.stopPropagation(),this.requestClose(n)}async handleDialogPointerDown(o){if(o.target===this.dialog&&!f1(o,this.dialog))if(this.lightDismiss)this.requestClose(this.dialog);else await E(this.dialog,"pulse")}handleRenderedChange(o){if(!this.open){this.renderedWatcher.stop();return}if(!o&&this.dialog.open)this.removeOpenListeners(),this.dialog.close(),L2(this);else if(o&&!this.dialog.open)this.addOpenListeners(),this.dialog.showModal(),z2(this)}handleOpenChange(){if(this.open&&!this.dialog.open)this.show();else if(!this.open&&this.dialog.open)this.open=!0,this.requestClose(this.dialog);else if(!this.open)this.renderedWatcher.stop()}async show(){let o=new C2;if(this.dispatchEvent(o),o.defaultPrevented){this.open=!1;return}this.addOpenListeners(),this.originalTrigger=document.activeElement,this.open=!0,this.dialog.showModal(),z2(this),this.renderedWatcher.start(this.dialog),requestAnimationFrame(()=>{let a=this.querySelector("[autofocus]");if(a&&typeof a.focus==="function")a.focus();else this.dialog.focus()}),await E(this.dialog,"show"),this.dispatchEvent(new y2)}render(){let o=!this.withoutHeader,a=this.hasSlotController.test("footer","withFooter"),n=this.label.length>0||this.hasSlotController.test("label","withLabel");return M`
      <dialog
        part="dialog"
        aria-labelledby=${U(o&&n?"title":void 0)}
        aria-label=${U(!o&&this.label?this.label:void 0)}
        class=${eo({dialog:!0,open:this.open})}
        @cancel=${this.handleDialogCancel}
        @click=${this.handleDialogClick}
        @pointerdown=${this.handleDialogPointerDown}
      >
        ${o?M`
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
                    @click="${(r)=>this.requestClose(r.target)}"
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
        <div part="footer" class="footer" ?hidden=${!a}>
          <slot name="footer"></slot>
        </div>
      </dialog>
    `}};H.css=p1;w([X(".dialog")],H.prototype,"dialog",2);w([g({type:Boolean,reflect:!0})],H.prototype,"open",2);w([g({reflect:!0})],H.prototype,"label",2);w([g({attribute:"without-header",type:Boolean,reflect:!0})],H.prototype,"withoutHeader",2);w([g({attribute:"light-dismiss",type:Boolean})],H.prototype,"lightDismiss",2);w([g({attribute:"with-footer",type:Boolean})],H.prototype,"withFooter",2);w([g({attribute:"with-label",type:Boolean})],H.prototype,"withLabel",2);w([B("open",{waitUntilFirstUpdate:!0})],H.prototype,"handleOpenChange",1);H=w([Y("wa-dialog")],H);if(!P)document.addEventListener("click",(o)=>{let a=o.target.closest("[data-dialog]");if(a instanceof Element){let[n,r]=d1(a.getAttribute("data-dialog")||"");if(n==="open"&&r?.length){let c=a.getRootNode().getElementById(r);if(c?.localName==="wa-dialog")c.open=!0;else console.warn(`A dialog with an ID of "${r}" could not be found in this document.`)}}}),document.addEventListener("pointerdown",()=>{});/*! Copyright 2026 Fonticons, Inc. - https://webawesome.com/license *//*! Copyright 2026 Fonticons, Inc. - https://webawesome.com/license */var z1=class extends Event{constructor(o){super("wa-select",{bubbles:!0,cancelable:!0,composed:!0});this.detail=o}};/*! Copyright 2026 Fonticons, Inc. - https://webawesome.com/license */function*r0(o=document.activeElement){if(o===null||o===void 0)return;if(yield o,"shadowRoot"in o&&o.shadowRoot&&o.shadowRoot.mode!=="closed")yield*r0(o.shadowRoot.activeElement)}/*! Copyright 2026 Fonticons, Inc. - https://webawesome.com/license */var L1=y`
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
`;var C1="useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict";var x1=(o=21)=>{let a="",n=crypto.getRandomValues(new Uint8Array(o|=0));while(o--)a+=C1[n[o]&63];return a};/*! Copyright 2026 Fonticons, Inc. - https://webawesome.com/license */function F1(o=""){return`${o}${x1()}`}var{min:oo,max:A,round:o2,floor:a2}=Math,ao=(o)=>({x:o,y:o}),X4={left:"right",right:"left",bottom:"top",top:"bottom"};function i0(o,a,n){return A(o,oo(a,n))}function ko(o,a){return typeof o==="function"?o(a):o}function bo(o){return o.split("-")[0]}function $o(o){return o.split("-")[1]}function c0(o){return o==="x"?"y":"x"}function q2(o){return o==="y"?"height":"width"}function no(o){let a=o[0];return a==="t"||a==="b"?"y":"x"}function k2(o){return c0(no(o))}function e1(o,a,n){if(n===void 0)n=!1;let r=$o(o),i=k2(o),c=q2(i),t=i==="x"?r===(n?"end":"start")?"right":"left":r==="start"?"bottom":"top";if(a.reference[c]>a.floating[c])t=_o(t);return[t,_o(t)]}function q1(o){let a=_o(o);return[e2(o),a,e2(a)]}function e2(o){return o.includes("start")?o.replace("start","end"):o.replace("end","start")}var y1=["left","right"],M1=["right","left"],G4=["top","bottom"],K4=["bottom","top"];function V4(o,a,n){switch(o){case"top":case"bottom":if(n)return a?M1:y1;return a?y1:M1;case"left":case"right":return a?G4:K4;default:return[]}}function k1(o,a,n,r){let i=$o(o),c=V4(bo(o),n==="start",r);if(i){if(c=c.map((t)=>t+"-"+i),a)c=c.concat(c.map(e2))}return c}function _o(o){let a=bo(o);return X4[a]+o.slice(a.length)}function H4(o){var a,n,r,i;return{top:(a=o.top)!=null?a:0,right:(n=o.right)!=null?n:0,bottom:(r=o.bottom)!=null?r:0,left:(i=o.left)!=null?i:0}}function t0(o){return typeof o!=="number"?H4(o):{top:o,right:o,bottom:o,left:o}}function To(o){let{x:a,y:n,width:r,height:i}=o;return{width:r,height:i,top:n,left:a,right:a+r,bottom:n+i,x:a,y:n}}function $1(o,a,n){let{reference:r,floating:i}=o,c=no(a),t=k2(a),s=q2(t),u=bo(a),m=c==="y",l=r.x+r.width/2-i.width/2,b=r.y+r.height/2-i.height/2,h=r[s]/2-i[s]/2,v;switch(u){case"top":v={x:l,y:r.y-i.height};break;case"bottom":v={x:l,y:r.y+r.height};break;case"right":v={x:r.x+r.width,y:b};break;case"left":v={x:r.x-i.width,y:b};break;default:v={x:r.x,y:r.y}}let f=$o(a);if(f)v[t]+=h*(f==="end"?1:-1)*(n&&m?-1:1);return v}async function T1(o,a){var n;if(a===void 0)a={};let{x:r,y:i,platform:c,rects:t,elements:s,strategy:u}=o,{boundary:m="clippingAncestors",rootBoundary:l="viewport",elementContext:b="floating",altBoundary:h=!1,padding:v=0}=ko(a,o),f=t0(v),L=s[h?b==="floating"?"reference":"floating":b],p=To(await c.getClippingRect({element:((n=await(c.isElement==null?void 0:c.isElement(L)))!=null?n:!0)?L:L.contextElement||await(c.getDocumentElement==null?void 0:c.getDocumentElement(s.floating)),boundary:m,rootBoundary:l,strategy:u})),C=b==="floating"?{x:r,y:i,width:t.floating.width,height:t.floating.height}:t.reference,F=await(c.getOffsetParent==null?void 0:c.getOffsetParent(s.floating)),e=await(c.isElement==null?void 0:c.isElement(F))&&await(c.getScale==null?void 0:c.getScale(F))||{x:1,y:1},K=To(c.convertOffsetParentRelativeRectToViewportRelativeRect?await c.convertOffsetParentRelativeRectToViewportRelativeRect({elements:s,rect:C,offsetParent:F,strategy:u}):C);return{top:(p.top-K.top+f.top)/e.y,bottom:(K.bottom-p.bottom+f.bottom)/e.y,left:(p.left-K.left+f.left)/e.x,right:(K.right-p.right+f.right)/e.x}}var N4=50,Y1=async(o,a,n)=>{let{placement:r="bottom",strategy:i="absolute",middleware:c=[],platform:t}=n,s=t.detectOverflow?t:{...t,detectOverflow:T1},u=await(t.isRTL==null?void 0:t.isRTL(a)),m=await t.getElementRects({reference:o,floating:a,strategy:i}),{x:l,y:b}=$1(m,r,u),h=r,v=0,f={};for(let d=0;d<c.length;d++){let L=c[d];if(!L)continue;let{name:p,fn:C}=L,{x:F,y:e,data:K,reset:k}=await C({x:l,y:b,initialPlacement:r,placement:h,strategy:i,middlewareData:f,rects:m,platform:s,elements:{reference:o,floating:a}});if(l=F!=null?F:l,b=e!=null?e:b,f[p]={...f[p],...K},k&&v<N4){if(v++,typeof k==="object"){if(k.placement)h=k.placement;if(k.rects)m=k.rects===!0?await t.getElementRects({reference:o,floating:a,strategy:i}):k.rects;({x:l,y:b}=$1(m,h,u))}d=-1}}return{x:l,y:b,placement:h,strategy:i,middlewareData:f}},U1=(o)=>({name:"arrow",options:o,async fn(a){let{x:n,y:r,placement:i,rects:c,platform:t,elements:s,middlewareData:u}=a,{element:m,padding:l=0}=ko(o,a)||{};if(m==null)return{};let b=t0(l),h={x:n,y:r},v=k2(i),f=q2(v),d=await t.getDimensions(m),L=v==="y",p=L?"top":"left",C=L?"bottom":"right",F=L?"clientHeight":"clientWidth",e=c.reference[f]+c.reference[v]-h[v]-c.floating[f],K=h[v]-c.reference[v],k=await(t.getOffsetParent==null?void 0:t.getOffsetParent(m)),V=k?k[F]:0;if(!V||!await(t.isElement==null?void 0:t.isElement(k)))V=s.floating[F]||c.floating[f];let N=e/2-K/2,D=V/2-d[f]/2-1,J=oo(b[p],D),Ho=oo(b[C],D),No=V-d[f]-Ho,W=V/2-d[f]/2+N,I=i0(J,W,No),fo=!u.arrow&&$o(i)!=null&&W!==I&&c.reference[f]/2-(W<J?J:Ho)-d[f]/2<0,io=fo?W<J?W-J:W-No:0;return{[v]:h[v]+io,data:{[v]:I,centerOffset:W-I-io,...fo&&{alignmentOffset:io}},reset:fo}}});var Z1=function(o){if(o===void 0)o={};return{name:"flip",options:o,async fn(a){var n,r;let{placement:i,middlewareData:c,rects:t,initialPlacement:s,platform:u,elements:m}=a,{mainAxis:l=!0,crossAxis:b=!0,fallbackPlacements:h,fallbackStrategy:v="bestFit",fallbackAxisSideDirection:f="none",flipAlignment:d=!0,...L}=ko(o,a);if((n=c.arrow)!=null&&n.alignmentOffset)return{};let p=bo(i),C=no(s),F=bo(s)===s,e=await(u.isRTL==null?void 0:u.isRTL(m.floating)),K=h||(F||!d?[_o(s)]:q1(s)),k=f!=="none";if(!h&&k)K.push(...k1(s,d,f,e));let V=[s,...K],N=await u.detectOverflow(a,L),D=[],J=((r=c.flip)==null?void 0:r.overflows)||[];if(l)D.push(N[p]);if(b){let I=e1(i,t,e);D.push(N[I[0]],N[I[1]])}if(J=[...J,{placement:i,overflows:D}],!D.every((I)=>I<=0)){var Ho,No;let I=(((Ho=c.flip)==null?void 0:Ho.index)||0)+1,fo=V[I];if(fo){if(!(b==="alignment"?C!==no(fo):!1)||J.every((j)=>no(j.placement)===C?j.overflows[0]>0:!0))return{data:{index:I,overflows:J},reset:{placement:fo}}}let io=(No=J.filter((po)=>po.overflows[0]<=0).sort((po,j)=>po.overflows[1]-j.overflows[1])[0])==null?void 0:No.placement;if(!io)switch(v){case"bestFit":{var W;let po=(W=J.filter((j)=>{if(k){let lo=no(j.placement);return lo===C||lo==="y"}return!0}).map((j)=>[j.placement,j.overflows.filter((lo)=>lo>0).reduce((lo,r4)=>lo+r4,0)]).sort((j,lo)=>j[1]-lo[1])[0])==null?void 0:W[0];if(po)io=po;break}case"initialPlacement":io=s;break}if(i!==io)return{reset:{placement:io}}}return{}}}};var I4=new Set(["left","top"]);async function j4(o,a){let{placement:n,platform:r,elements:i}=o,c=await(r.isRTL==null?void 0:r.isRTL(i.floating)),t=bo(n),s=$o(n),u=no(n)==="y",m=I4.has(t)?-1:1,l=c&&u?-1:1,b=ko(a,o),{mainAxis:h,crossAxis:v,alignmentAxis:f}=typeof b==="number"?{mainAxis:b,crossAxis:0,alignmentAxis:null}:{mainAxis:b.mainAxis||0,crossAxis:b.crossAxis||0,alignmentAxis:b.alignmentAxis};if(s&&typeof f==="number")v=s==="end"?f*-1:f;return u?{x:v*l,y:h*m}:{x:h*m,y:v*l}}var J1=function(o){if(o===void 0)o=0;return{name:"offset",options:o,async fn(a){var n,r;let{x:i,y:c,placement:t,middlewareData:s}=a,u=await j4(a,o);if(t===((n=s.offset)==null?void 0:n.placement)&&(r=s.arrow)!=null&&r.alignmentOffset)return{};return{x:i+u.x,y:c+u.y,data:{...u,placement:t}}}}},B1=function(o){if(o===void 0)o={};return{name:"shift",options:o,async fn(a){let{x:n,y:r,placement:i,platform:c}=a,{mainAxis:t=!0,crossAxis:s=!1,limiter:u={fn:(C)=>{let{x:F,y:e}=C;return{x:F,y:e}}},...m}=ko(o,a),l={x:n,y:r},b=await c.detectOverflow(a,m),h=no(i),v=c0(h),f=l[v],d=l[h],L=(C,F)=>i0(F+b[C==="y"?"top":"left"],F,F-b[C==="y"?"bottom":"right"]);if(t)f=L(v,f);if(s)d=L(h,d);let p=u.fn({...a,[v]:f,[h]:d});return{...p,data:{x:p.x-n,y:p.y-r,enabled:{[v]:t,[h]:s}}}}}};var Q1=function(o){if(o===void 0)o={};return{name:"size",options:o,async fn(a){let{placement:n,rects:r,platform:i,elements:c}=a,{apply:t=()=>{},...s}=ko(o,a),u=await i.detectOverflow(a,s),m=bo(n),l=$o(n),b=no(n)==="y",{width:h,height:v}=r.floating,f,d;if(m==="top"||m==="bottom")f=m,d=l===(await(i.isRTL==null?void 0:i.isRTL(c.floating))?"start":"end")?"left":"right";else d=m,f=l==="end"?"top":"bottom";let L=v-u.top-u.bottom,p=h-u.left-u.right,C=oo(v-u[f],L),F=oo(h-u[d],p),e=a.middlewareData.shift,K=!e,k=C,V=F;if(e!=null&&e.enabled.x)V=p;if(e!=null&&e.enabled.y)k=L;if(K&&!l)if(b)V=h-2*A(u.left,u.right);else k=v-2*A(u.top,u.bottom);await t({...a,availableWidth:V,availableHeight:k});let N=await i.getDimensions(c.floating);if(h!==N.width||v!==N.height)return{reset:{rects:!0}};return{}}}};function $2(){return typeof window<"u"}function Uo(o){if(G1(o))return(o.nodeName||"").toLowerCase();return"#document"}function G(o){var a;return(o==null||(a=o.ownerDocument)==null?void 0:a.defaultView)||window}function ro(o){var a;return(a=(G1(o)?o.ownerDocument:o.document)||window.document)==null?void 0:a.documentElement}function G1(o){if(!$2())return!1;return o instanceof Node||o instanceof G(o).Node}function S(o){if(!$2())return!1;return o instanceof Element||o instanceof G(o).Element}function wo(o){if(!$2())return!1;return o instanceof HTMLElement||o instanceof G(o).HTMLElement}function X1(o){if(!$2()||typeof ShadowRoot>"u")return!1;return o instanceof ShadowRoot||o instanceof G(o).ShadowRoot}function n2(o){let{overflow:a,overflowX:n,overflowY:r,display:i}=O(o);return/auto|scroll|overlay|hidden|clip/.test(a+r+n)&&i!=="inline"&&i!=="contents"}function K1(o){return/^(table|td|th)$/.test(Uo(o))}function r2(o){try{if(o.matches(":popover-open"))return!0}catch(a){}try{return o.matches(":modal")}catch(a){return!1}}var E4=/transform|translate|scale|rotate|perspective|filter/,A4=/paint|layout|strict|content/,Yo=(o)=>!!o&&o!=="none",s0;function Go(o){let a=S(o)?O(o):o;return Yo(a.transform)||Yo(a.translate)||Yo(a.scale)||Yo(a.rotate)||Yo(a.perspective)||!T2()&&(Yo(a.backdropFilter)||Yo(a.filter))||E4.test(a.willChange||"")||A4.test(a.contain||"")}function V1(o){let a=ho(o);while(wo(a)&&!Ko(a)){if(Go(a))return a;else if(r2(a))return null;a=ho(a)}return null}function T2(){if(s0==null)s0=typeof CSS<"u"&&CSS.supports&&CSS.supports("-webkit-backdrop-filter","none");return s0}function Ko(o){return/^(html|body|#document)$/.test(Uo(o))}function O(o){return G(o).getComputedStyle(o)}function i2(o){if(S(o))return{scrollLeft:o.scrollLeft,scrollTop:o.scrollTop};return{scrollLeft:o.scrollX,scrollTop:o.scrollY}}function ho(o){if(Uo(o)==="html")return o;let a=o.assignedSlot||o.parentNode||X1(o)&&o.host||ro(o);return X1(a)?a.host:a}function H1(o){let a=ho(o);if(Ko(a))return(o.ownerDocument||o).body;if(wo(a)&&n2(a))return a;return H1(a)}function so(o,a,n){var r;if(a===void 0)a=[];if(n===void 0)n=!0;let i=H1(o),c=i===((r=o.ownerDocument)==null?void 0:r.body),t=G(i);if(c){let s=Y2(t);return a.concat(t,t.visualViewport||[],n2(i)?i:[],s&&n?so(s):[])}else return a.concat(i,so(i,[],n))}function Y2(o){return o.parent&&Object.getPrototypeOf(o.parent)?o.frameElement:null}function j1(o){let a=O(o),n=parseFloat(a.width)||0,r=parseFloat(a.height)||0,i=wo(o),c=i?o.offsetWidth:n,t=i?o.offsetHeight:r,s=o2(n)!==c||o2(r)!==t;if(s)n=c,r=t;return{width:n,height:r,$:s}}function l0(o){return!S(o)?o.contextElement:o}function Vo(o){let a=l0(o);if(!wo(a))return ao(1);let n=a.getBoundingClientRect(),{width:r,height:i,$:c}=j1(a),t=(c?o2(n.width):n.width)/r,s=(c?o2(n.height):n.height)/i;if(!t||!Number.isFinite(t))t=1;if(!s||!Number.isFinite(s))s=1;return{x:t,y:s}}var S4=ao(0);function E1(o){let a=G(o);if(!T2()||!a.visualViewport)return S4;return{x:a.visualViewport.offsetLeft,y:a.visualViewport.offsetTop}}function O4(o,a,n){if(a===void 0)a=!1;return!!n&&a&&n===G(o)}function Zo(o,a,n,r){if(a===void 0)a=!1;if(n===void 0)n=!1;let i=o.getBoundingClientRect(),c=l0(o),t=ao(1);if(a)if(r){if(S(r))t=Vo(r)}else t=Vo(o);let s=O4(c,n,r)?E1(c):ao(0),u=(i.left+s.x)/t.x,m=(i.top+s.y)/t.y,l=i.width/t.x,b=i.height/t.y;if(c&&r){let h=G(c),v=S(r)?G(r):r,f=h,d=Y2(f);while(d&&v!==f){let L=Vo(d),p=d.getBoundingClientRect(),C=O(d),F=p.left+(d.clientLeft+parseFloat(C.paddingLeft))*L.x,e=p.top+(d.clientTop+parseFloat(C.paddingTop))*L.y;u*=L.x,m*=L.y,l*=L.x,b*=L.y,u+=F,m+=e,f=G(d),d=Y2(f)}}return To({width:l,height:b,x:u,y:m})}function U2(o,a){let n=i2(o).scrollLeft;if(!a)return Zo(ro(o)).left+n;return a.left+n}function A1(o,a){let n=o.getBoundingClientRect(),r=n.left+a.scrollLeft-U2(o,n),i=n.top+a.scrollTop;return{x:r,y:i}}function D4(o){let{elements:a,rect:n,offsetParent:r,strategy:i}=o,c=i==="fixed",t=ro(r),s=a?r2(a.floating):!1;if(r===t||s&&c)return n;let u={scrollLeft:0,scrollTop:0},m=ao(1),l=ao(0),b=wo(r);if(b||!c){if(Uo(r)!=="body"||n2(t))u=i2(r);if(b){let v=Zo(r);m=Vo(r),l.x=v.x+r.clientLeft,l.y=v.y+r.clientTop}}let h=t&&!b&&!c?A1(t,u):ao(0);return{width:n.width*m.x,height:n.height*m.y,x:n.x*m.x-u.scrollLeft*m.x+l.x+h.x,y:n.y*m.y-u.scrollTop*m.y+l.y+h.y}}function W4(o){return o.getClientRects?Array.from(o.getClientRects()):[]}function P4(o){let a=i2(o),n=o.ownerDocument.body,r=A(o.scrollWidth,o.clientWidth,n.scrollWidth,n.clientWidth),i=A(o.scrollHeight,o.clientHeight,n.scrollHeight,n.clientHeight),c=-a.scrollLeft+U2(o),t=-a.scrollTop;if(O(n).direction==="rtl")c+=A(o.clientWidth,n.clientWidth)-r;return{width:r,height:i,x:c,y:t}}var R4=25;function _4(o,a,n){if(n===void 0)n="viewport";let r=n==="layoutViewport",i=G(o),c=ro(o),t=i.visualViewport,s=c.clientWidth,u=c.clientHeight,m=0,l=0;if(t){let h=!T2()||a==="fixed";if(r){if(!h)m=-t.offsetLeft,l=-t.offsetTop}else if(s=t.width,u=t.height,h)m=t.offsetLeft,l=t.offsetTop}if(U2(c)<=0){let h=c.ownerDocument,v=h.body,f=getComputedStyle(v),d=h.compatMode==="CSS1Compat"?parseFloat(f.marginLeft)+parseFloat(f.marginRight)||0:0,L=Math.abs(c.clientWidth-v.clientWidth-d),p=getComputedStyle(c).scrollbarGutter==="stable both-edges"?L/2:L;if(p<=R4)s-=p}return{width:s,height:u,x:m,y:l}}function oa(o,a){let n=Zo(o,!0,a==="fixed"),r=n.top+o.clientTop,i=n.left+o.clientLeft,c=Vo(o),t=o.clientWidth*c.x,s=o.clientHeight*c.y,u=i*c.x,m=r*c.y;return{width:t,height:s,x:u,y:m}}function N1(o,a,n){let r;if(a==="viewport"||a==="layoutViewport")r=_4(o,n,a);else if(a==="document")r=P4(ro(o));else if(S(a))r=oa(a,n);else{let i=E1(o);r={x:a.x-i.x,y:a.y-i.y,width:a.width,height:a.height}}return To(r)}function aa(o,a){let n=a.get(o);if(n)return n;let r=so(o,[],!1).filter((s)=>S(s)&&Uo(s)!=="body"),i=null,c=O(o).position==="fixed",t=c?ho(o):o;while(S(t)&&!Ko(t)){let s=O(t),u=Go(t),m=i?i.position:c?"fixed":"";if(!u&&(m==="fixed"||m==="absolute"&&s.position==="static"))r=r.filter((b)=>b!==t);else i=s;t=ho(t)}return a.set(o,r),r}function na(o){let{element:a,boundary:n,rootBoundary:r,strategy:i}=o,t=[...n==="clippingAncestors"?r2(a)?[]:aa(a,this._c):[].concat(n),r],s=N1(a,t[0],i),u=s.top,m=s.right,l=s.bottom,b=s.left;for(let h=1;h<t.length;h++){let v=N1(a,t[h],i);u=A(v.top,u),m=oo(v.right,m),l=oo(v.bottom,l),b=A(v.left,b)}return{width:m-b,height:l-u,x:b,y:u}}function ra(o){let{width:a,height:n}=j1(o);return{width:a,height:n}}function ia(o,a,n){let r=wo(a),i=ro(a),c=n==="fixed",t=Zo(o,!0,c,a),s={scrollLeft:0,scrollTop:0},u=ao(0);if(r||!c){if(Uo(a)!=="body"||n2(i))s=i2(a);if(r){let h=Zo(a,!0,c,a);u.x=h.x+a.clientLeft,u.y=h.y+a.clientTop}}if(!r&&i)u.x=U2(i);let m=i&&!r&&!c?A1(i,s):ao(0),l=t.left+s.scrollLeft-u.x-m.x,b=t.top+s.scrollTop-u.y-m.y;return{x:l,y:b,width:t.width,height:t.height}}function w0(o){return O(o).position==="static"}function I1(o,a){if(!wo(o)||O(o).position==="fixed")return null;if(a)return a(o);let n=o.offsetParent;if(ro(o)===n)n=n.ownerDocument.body;return n}function S1(o,a){let n=G(o);if(r2(o))return n;if(!wo(o)){let i=ho(o);while(i&&!Ko(i)){if(S(i)&&!w0(i))return i;i=ho(i)}return n}let r=I1(o,a);while(r&&K1(r)&&w0(r))r=I1(r,a);if(r&&Ko(r)&&w0(r)&&!Go(r))return n;return r||V1(o)||n}var ca=async function(o){let a=this.getOffsetParent||S1,n=this.getDimensions,r=await n(o.floating);return{reference:ia(o.reference,await a(o.floating),o.strategy),floating:{x:0,y:0,width:r.width,height:r.height}}};function ta(o){return O(o).direction==="rtl"}var c2={convertOffsetParentRelativeRectToViewportRelativeRect:D4,getDocumentElement:ro,getClippingRect:na,getOffsetParent:S1,getElementRects:ca,getClientRects:W4,getDimensions:ra,getScale:Vo,isElement:S,isRTL:ta};function O1(o,a){return o.x===a.x&&o.y===a.y&&o.width===a.width&&o.height===a.height}function sa(o,a,n){let r=null,i,c=ro(o);function t(){var l;clearTimeout(i),(l=r)==null||l.disconnect(),r=null}function s(l,b){if(l===void 0)l=!1;if(b===void 0)b=1;t();let h=o.getBoundingClientRect(),{left:v,top:f,width:d,height:L}=h;if(!l)a();if(!d||!L)return;let p=a2(f),C=a2(c.clientWidth-(v+d)),F=a2(c.clientHeight-(f+L)),e=a2(v),k={rootMargin:-p+"px "+-C+"px "+-F+"px "+-e+"px",threshold:A(0,oo(1,b))||1},V=!0;function N(D){let J=D[0].intersectionRatio;if(!O1(h,o.getBoundingClientRect()))return s();if(J!==b){if(!V)return s();if(!J)i=setTimeout(()=>{s(!1,0.0000001)},1000);else s(!1,J)}V=!1}try{r=new IntersectionObserver(N,{...k,root:c.ownerDocument})}catch(D){r=new IntersectionObserver(N,k)}r.observe(o)}let u=G(o),m=()=>s(n);return u.addEventListener("resize",m),s(!0),()=>{u.removeEventListener("resize",m),t()}}function Z2(o,a,n,r){if(r===void 0)r={};let{ancestorScroll:i=!0,ancestorResize:c=!0,elementResize:t=typeof ResizeObserver==="function",layoutShift:s=typeof IntersectionObserver==="function",animationFrame:u=!1}=r,m=l0(o),l=i||c?[...m?so(m):[],...a?so(a):[]]:[];l.forEach((p)=>{i&&p.addEventListener("scroll",n),c&&p.addEventListener("resize",n)});let b=m&&s?sa(m,n,c):null,h=-1,v=null;if(t){if(v=new ResizeObserver((p)=>{let[C]=p;if(C&&C.target===m&&v&&a)v.unobserve(a),cancelAnimationFrame(h),h=requestAnimationFrame(()=>{var F;(F=v)==null||F.observe(a)});n()}),m&&!u)v.observe(m);if(a)v.observe(a)}let f,d=u?Zo(o):null;if(u)L();function L(){let p=Zo(o);if(d&&!O1(d,p))n();d=p,f=requestAnimationFrame(L)}return n(),()=>{var p;if(l.forEach((C)=>{i&&C.removeEventListener("scroll",n),c&&C.removeEventListener("resize",n)}),b==null||b(),(p=v)==null||p.disconnect(),v=null,u)cancelAnimationFrame(f)}}var J2=J1;var B2=B1,Q2=Z1,u0=Q1;var D1=U1;var X2=(o,a,n)=>{let r=new Map,i=n!=null?n:{},c={...c2,...i.platform,_c:r};return Y1(o,a,{...i,platform:c})};/*! Copyright 2026 Fonticons, Inc. - https://webawesome.com/license */var m0=new Set,Q=class extends ${constructor(){super(...arguments);this.submenuCleanups=new Map,this.localize=new _(this),this.userTypedQuery="",this.openSubmenuStack=[],this.open=!1,this.size="m",this.placement="bottom-start",this.distance=0,this.skidding=0,this.handleDocumentKeyDown=async(o)=>{let a=this.localize.dir()==="rtl";if(o.key==="Escape"&&this.open&&Ro(this)){let l=this.getTrigger();o.preventDefault(),o.stopPropagation(),this.open=!1,l?.focus({preventScroll:!0});return}let n=[...r0()].find((l)=>l.localName==="wa-dropdown-item"),r=n?.localName==="wa-dropdown-item",i=this.getCurrentSubmenuItem(),c=!!i,t,s,u;if(c)t=this.getSubmenuItems(i),s=t.find((l)=>l.active||l===n),u=s?t.indexOf(s):-1;else t=this.getItems(),s=t.find((l)=>l.active||l===n),u=s?t.indexOf(s):-1;let m;if(o.key==="ArrowUp")if(o.preventDefault(),o.stopPropagation(),u>0)m=t[u-1];else m=t[t.length-1];if(o.key==="ArrowDown")if(o.preventDefault(),o.stopPropagation(),u!==-1&&u<t.length-1)m=t[u+1];else m=t[0];if(o.key===(a?"ArrowLeft":"ArrowRight")&&r&&s){if(s.hasSubmenu){o.preventDefault(),o.stopPropagation(),s.submenuOpen=!0,this.addToSubmenuStack(s),setTimeout(()=>{let l=this.getSubmenuItems(s);if(l.length>0)l.forEach((b,h)=>b.active=h===0),l[0].focus({preventScroll:!0})},0);return}}if(o.key===(a?"ArrowRight":"ArrowLeft")&&c){o.preventDefault(),o.stopPropagation();let l=this.removeFromSubmenuStack();if(l)l.submenuOpen=!1,setTimeout(()=>{l.focus({preventScroll:!0}),l.active=!0,(l.slot==="submenu"?this.getSubmenuItems(l.parentElement):this.getItems()).forEach((h)=>{if(h!==l)h.active=!1})},0);return}if(o.key==="Home"||o.key==="End")o.preventDefault(),o.stopPropagation(),m=o.key==="Home"?t[0]:t[t.length-1];if(o.key==="Tab")await this.hideMenu();if(o.key.length===1&&!(o.metaKey||o.ctrlKey||o.altKey)&&!(o.key===" "&&this.userTypedQuery===""))clearTimeout(this.userTypedTimeout),this.userTypedTimeout=setTimeout(()=>{this.userTypedQuery=""},1000),this.userTypedQuery+=o.key,t.some((l)=>{let b=(l.textContent||"").trim().toLowerCase(),h=this.userTypedQuery.trim().toLowerCase();if(b.startsWith(h))return m=l,!0;return!1});if(m){o.preventDefault(),o.stopPropagation(),t.forEach((l)=>l.active=l===m),m.focus({preventScroll:!0}),m.scrollIntoView({block:"nearest"});return}if((o.key==="Enter"||o.key===" "&&this.userTypedQuery==="")&&r&&s)if(o.preventDefault(),o.stopPropagation(),s.hasSubmenu)s.submenuOpen=!0,this.addToSubmenuStack(s),setTimeout(()=>{let l=this.getSubmenuItems(s);if(l.length>0)l.forEach((b,h)=>b.active=h===0),l[0].focus({preventScroll:!0})},0);else this.makeSelection(s,o)},this.handleDocumentPointerDown=(o)=>{if(!o.composedPath().some((r)=>{if(r instanceof HTMLElement)return r===this||r.closest('wa-dropdown, [part="submenu"]');return!1}))this.open=!1},this.handleGlobalMouseMove=(o)=>{let a=this.getCurrentSubmenuItem();if(!a?.submenuOpen||!a.submenuElement)return;let n=a.submenuElement.getBoundingClientRect(),r=this.localize.dir()==="rtl",i=r?n.right:n.left,c=r?Math.max(o.clientX,i):Math.min(o.clientX,i),t=Math.max(n.top,Math.min(o.clientY,n.bottom));a.submenuElement.style.setProperty("--safe-triangle-cursor-x",`${c}px`),a.submenuElement.style.setProperty("--safe-triangle-cursor-y",`${t}px`);let s=o.composedPath(),u=a.matches(":hover"),m=Boolean(a.submenuElement?.matches(":hover")),l=u||!!s.find((h)=>h===a),b=m||!!s.find((h)=>h instanceof HTMLElement&&h.closest('[part="submenu"]')===a.submenuElement);if(!l&&!b)setTimeout(()=>{if(!u&&!m)a.submenuOpen=!1},100)}}handleSizeChange(){Bo(this.localName,this.size)}disconnectedCallback(){super.disconnectedCallback(),clearInterval(this.userTypedTimeout),this.closeAllSubmenus(),this.submenuCleanups.forEach((o)=>o()),this.submenuCleanups.clear(),document.removeEventListener("mousemove",this.handleGlobalMouseMove),document.removeEventListener("keydown",this.handleDocumentKeyDown),document.removeEventListener("pointerdown",this.handleDocumentPointerDown),Xo(this)}firstUpdated(o){super.firstUpdated(o),this.syncAriaAttributes()}async updated(o){if(o.has("open")){let a=o.get("open");if(a===this.open)return;if(a===void 0&&this.open===!1)return;if(this.customStates.set("open",this.open),this.open)await this.showMenu();else this.closeAllSubmenus(),await this.hideMenu()}if(o.has("size"))this.syncItemSizes()}getItems(o=!1){let a=(this.defaultSlot?.assignedElements({flatten:!0})??[]).filter((n)=>n.localName==="wa-dropdown-item");return o?a:a.filter((n)=>!n.disabled)}getSubmenuItems(o,a=!1){let n=o.shadowRoot?.querySelector('slot[name="submenu"]')||o.querySelector('slot[name="submenu"]');if(!n)return[];let r=n.assignedElements({flatten:!0}).filter((i)=>i.localName==="wa-dropdown-item");return a?r:r.filter((i)=>!i.disabled)}syncItemSizes(){(this.defaultSlot?.assignedElements({flatten:!0})??[]).filter((a)=>a.localName==="wa-dropdown-item").forEach((a)=>a.size=this.size)}addToSubmenuStack(o){let a=this.openSubmenuStack.indexOf(o);if(a!==-1)this.openSubmenuStack=this.openSubmenuStack.slice(0,a+1);else this.openSubmenuStack.push(o)}removeFromSubmenuStack(){return this.openSubmenuStack.pop()}getCurrentSubmenuItem(){return this.openSubmenuStack.length>0?this.openSubmenuStack[this.openSubmenuStack.length-1]:void 0}closeAllSubmenus(){this.getItems(!0).forEach((a)=>{a.submenuOpen=!1}),this.openSubmenuStack=[]}closeSiblingSubmenus(o){let a=o.closest('wa-dropdown-item:not([slot="submenu"])'),n;if(a)n=this.getSubmenuItems(a,!0);else n=this.getItems(!0);if(n.forEach((r)=>{if(r!==o&&r.submenuOpen)r.submenuOpen=!1}),!this.openSubmenuStack.includes(o))this.openSubmenuStack.push(o)}getTrigger(){return this.querySelector('[slot="trigger"]')}async showMenu(){if(!this.getTrigger()||!this.popup||!this.menu)return;let a=new C2;if(this.dispatchEvent(a),a.defaultPrevented){this.open=!1;return}if(this.popup.active)return;m0.forEach((r)=>r.open=!1),this.popup.active=!0,this.open=!0,m0.add(this),M2(this),this.syncAriaAttributes(),document.addEventListener("keydown",this.handleDocumentKeyDown),document.addEventListener("pointerdown",this.handleDocumentPointerDown),document.addEventListener("mousemove",this.handleGlobalMouseMove),this.menu.classList.remove("hide"),await E(this.menu,"show");let n=this.getItems();if(n.length>0)n.forEach((r,i)=>r.active=i===0),n[0].focus({preventScroll:!0});this.dispatchEvent(new y2)}async hideMenu(){if(!this.popup||!this.menu)return;let o=new x2({source:this});if(this.dispatchEvent(o),o.defaultPrevented){this.open=!0;return}this.open=!1,m0.delete(this),Xo(this),this.syncAriaAttributes(),document.removeEventListener("keydown",this.handleDocumentKeyDown),document.removeEventListener("pointerdown",this.handleDocumentPointerDown),document.removeEventListener("mousemove",this.handleGlobalMouseMove),this.menu.classList.remove("show"),await E(this.menu,"hide"),this.popup.active=this.open,this.dispatchEvent(new F2)}handleMenuClick(o){let a=o.target.closest("wa-dropdown-item");if(!a||a.disabled)return;if(a.hasSubmenu){if(!a.submenuOpen)this.closeSiblingSubmenus(a),this.addToSubmenuStack(a),a.submenuOpen=!0;o.stopPropagation();return}this.makeSelection(a,o)}async handleMenuSlotChange(){let o=this.getItems(!0);await Promise.all(o.map((r)=>r.updateComplete)),this.syncItemSizes();let a=o.some((r)=>r.type==="checkbox"),n=o.some((r)=>r.hasSubmenu);o.forEach((r,i)=>{r.setAttribute("aria-posinset",String(i+1)),r.setAttribute("aria-setsize",String(o.length)),r.active=i===0,r.checkboxAdjacent=a,r.submenuAdjacent=n})}handleTriggerClick(){this.open=!this.open}handleSubmenuOpening(o){let a=o.detail.item;this.closeSiblingSubmenus(a),this.addToSubmenuStack(a),this.setupSubmenuPosition(a),this.processSubmenuItems(a)}setupSubmenuPosition(o){if(!o.submenuElement)return;this.cleanupSubmenuPosition(o);let a=Z2(o,o.submenuElement,()=>{this.positionSubmenu(o),this.updateSafeTriangleCoordinates(o)});this.submenuCleanups.set(o,a);let n=o.submenuElement.querySelector('slot[name="submenu"]');if(n)n.removeEventListener("slotchange",Q.handleSubmenuSlotChange),n.addEventListener("slotchange",Q.handleSubmenuSlotChange),Q.handleSubmenuSlotChange({target:n})}static handleSubmenuSlotChange(o){let a=o.target;if(!a)return;let n=a.assignedElements().filter((c)=>c.localName==="wa-dropdown-item");if(n.length===0)return;let r=n.some((c)=>c.hasSubmenu),i=n.some((c)=>c.type==="checkbox");n.forEach((c)=>{c.submenuAdjacent=r,c.checkboxAdjacent=i})}processSubmenuItems(o){if(!o.submenuElement)return;let a=this.getSubmenuItems(o,!0),n=a.some((r)=>r.hasSubmenu);a.forEach((r)=>{r.submenuAdjacent=n})}cleanupSubmenuPosition(o){let a=this.submenuCleanups.get(o);if(a)a(),this.submenuCleanups.delete(o)}positionSubmenu(o){if(!o.submenuElement)return;let n=this.localize.dir()==="rtl"?"left-start":"right-start";X2(o,o.submenuElement,{placement:n,middleware:[J2({mainAxis:0,crossAxis:-5}),Q2({fallbackStrategy:"bestFit"}),B2({padding:8,crossAxis:!0})]}).then(({x:r,y:i,placement:c})=>{o.submenuElement.setAttribute("data-placement",c),Object.assign(o.submenuElement.style,{left:`${r}px`,top:`${i}px`})})}updateSafeTriangleCoordinates(o){if(!o.submenuElement||!o.submenuOpen)return;if(document.activeElement?.matches(":focus-visible")){o.submenuElement.style.setProperty("--safe-triangle-visible","none");return}o.submenuElement.style.setProperty("--safe-triangle-visible","block");let n=o.submenuElement.getBoundingClientRect(),r=this.localize.dir()==="rtl";o.submenuElement.style.setProperty("--safe-triangle-submenu-start-x",`${r?n.right:n.left}px`),o.submenuElement.style.setProperty("--safe-triangle-submenu-start-y",`${n.top}px`),o.submenuElement.style.setProperty("--safe-triangle-submenu-end-x",`${r?n.right:n.left}px`),o.submenuElement.style.setProperty("--safe-triangle-submenu-end-y",`${n.bottom}px`)}makeSelection(o,a){let n=this.getTrigger();if(o.disabled)return;if(o.type==="checkbox")o.checked=!o.checked;let r=new z1({item:o});if(this.dispatchEvent(r),!r.defaultPrevented)o.navigate(a),this.open=!1,n?.focus({preventScroll:!0})}async syncAriaAttributes(){let o=this.getTrigger(),a;if(!o)return;if(o.localName==="wa-button")await customElements.whenDefined("wa-button"),await o.updateComplete,a=o.shadowRoot.querySelector('[part~="base"]');else a=o;if(!a.hasAttribute("id"))a.setAttribute("id",F1("wa-dropdown-trigger-"));a.setAttribute("aria-haspopup","menu"),a.setAttribute("aria-expanded",this.open?"true":"false"),this.menu?.setAttribute("aria-expanded","false")}render(){let o=this.didSSR&&!this.hasUpdated?this.open:this.popup?.active;return M`
      <wa-popup
        placement=${this.placement}
        distance=${this.distance}
        skidding=${this.skidding}
        ?active=${o}
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
    `}};Q.css=[v2,L1];w([X("slot:not([name])")],Q.prototype,"defaultSlot",2);w([X("#menu")],Q.prototype,"menu",2);w([X("wa-popup")],Q.prototype,"popup",2);w([g({type:Boolean,reflect:!0})],Q.prototype,"open",2);w([g({reflect:!0})],Q.prototype,"size",2);w([B("size")],Q.prototype,"handleSizeChange",1);w([g({reflect:!0})],Q.prototype,"placement",2);w([g({type:Number})],Q.prototype,"distance",2);w([g({type:Number})],Q.prototype,"skidding",2);Q=w([Y("wa-dropdown")],Q);/*! Copyright 2026 Fonticons, Inc. - https://webawesome.com/license */var W1=y`
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
`;/*! Copyright 2026 Fonticons, Inc. - https://webawesome.com/license */var q=class extends ${constructor(){super(...arguments);this.hasSlotController=new go(this,"[default]","start","end"),this.active=!1,this.variant="default",this.size="m",this.checkboxAdjacent=!1,this.submenuAdjacent=!1,this.type="normal",this.checked=!1,this.disabled=!1,this.submenuOpen=!1,this.hasSubmenu=!1,this.handleSlotChange=()=>{if(this.hasSubmenu=this.hasSlotController.test("submenu"),this.updateHasSubmenuState(),this.hasSubmenu)this.setAttribute("aria-haspopup","menu"),this.setAttribute("aria-expanded",this.submenuOpen?"true":"false");else this.removeAttribute("aria-haspopup"),this.removeAttribute("aria-expanded")},this.handleHostClick=(o)=>{if(this.disabled)o.preventDefault(),o.stopImmediatePropagation()},this.handleClick=(o)=>{if(this.disabled)o.preventDefault(),o.stopImmediatePropagation()},this.handlePointerEnter=(o)=>{if(o.pointerType==="mouse"&&this.hasSubmenu&&!this.disabled)this.notifyParentOfOpening(),this.submenuOpen=!0}}handleSizeChange(){Bo(this.localName,this.size)}connectedCallback(){super.connectedCallback(),this.addEventListener?.("click",this.handleHostClick),this.addEventListener?.("pointerenter",this.handlePointerEnter),this.shadowRoot?.addEventListener?.("click",this.handleClick,{capture:!0}),this.shadowRoot?.addEventListener?.("slotchange",this.handleSlotChange)}disconnectedCallback(){super.disconnectedCallback(),this.closeSubmenu(),this.removeEventListener?.("click",this.handleHostClick),this.removeEventListener?.("pointerenter",this.handlePointerEnter),this.shadowRoot?.removeEventListener?.("click",this.handleClick,{capture:!0}),this.shadowRoot?.removeEventListener?.("slotchange",this.handleSlotChange)}firstUpdated(o){super.firstUpdated(o),this.setAttribute("tabindex","-1"),this.hasSubmenu=this.hasSlotController.test("submenu"),this.updateHasSubmenuState()}updated(o){if(o.has("active"))this.setAttribute("tabindex",this.active?"0":"-1"),this.customStates.set("active",this.active);if(o.has("checked")){if(this.type==="checkbox")this.setAttribute("aria-checked",this.checked?"true":"false");else this.removeAttribute("aria-checked");this.customStates.set("checked",this.checked)}if(o.has("disabled"))this.setAttribute("aria-disabled",this.disabled?"true":"false"),this.customStates.set("disabled",this.disabled);if(o.has("type"))if(this.type==="checkbox")this.setAttribute("role","menuitemcheckbox"),this.setAttribute("aria-checked",this.checked?"true":"false");else this.setAttribute("role","menuitem"),this.removeAttribute("aria-checked");if(o.has("href")||o.has("hasSubmenu"))this.customStates.set("link",this.isLink());if(o.has("submenuOpen"))if(this.customStates.set("submenu-open",this.submenuOpen),this.submenuOpen)this.openSubmenu();else this.closeSubmenu()}updateHasSubmenuState(){this.customStates.set("has-submenu",this.hasSubmenu)}async openSubmenu(){let o=this.submenuElement;if(!this.hasSubmenu||!o||!this.isConnected)return;this.notifyParentOfOpening(),o.showPopover?.(),o.hidden=!1,o.setAttribute("data-visible",""),this.submenuOpen=!0,this.setAttribute("aria-expanded","true"),await E(o,"show"),setTimeout(()=>{let a=this.getSubmenuItems();if(a.length>0)a.forEach((n,r)=>n.active=r===0),a[0].focus({preventScroll:!0})},0)}notifyParentOfOpening(){let o=new CustomEvent("submenu-opening",{bubbles:!0,composed:!0,detail:{item:this}});this.dispatchEvent(o);let a=this.parentElement;if(a)[...a.children].filter((r)=>r!==this&&r.localName==="wa-dropdown-item"&&r.getAttribute("slot")===this.getAttribute("slot")&&r.submenuOpen).forEach((r)=>{r.submenuOpen=!1})}async closeSubmenu(){let o=this.submenuElement;if(!this.hasSubmenu||!o)return;if(this.submenuOpen=!1,this.setAttribute("aria-expanded","false"),!o.hidden){if(await E(o,"hide"),o?.isConnected)o.hidden=!0,o.removeAttribute("data-visible"),o.hidePopover?.()}}isLink(){return Boolean(this.href)&&!this.hasSubmenu}navigate(o){let a=this.linkElement;if(!this.isLink()||this.disabled||!a)return;a.dispatchEvent(new MouseEvent("click",{bubbles:!1,cancelable:!0,composed:!1,altKey:o?.altKey??!1,ctrlKey:o?.ctrlKey??!1,metaKey:o?.metaKey??!1,shiftKey:o?.shiftKey??!1}))}getSubmenuItems(){return[...this.children].filter((o)=>o.localName==="wa-dropdown-item"&&o.getAttribute("slot")==="submenu"&&!o.hasAttribute("disabled"))}render(){return M`
      ${this.href?M`
            <a
              id="link"
              href=${this.href}
              target=${U(this.target)}
              rel=${U(this.rel)}
              download=${U(this.download)}
              tabindex="-1"
              aria-hidden="true"
            ></a>
          `:""}
      ${this.type==="checkbox"?M`
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

      ${this.hasSubmenu?M`
            <wa-icon
              id="submenu-indicator"
              part="submenu-icon"
              exportparts="svg:submenu-icon__svg"
              library="system"
              name="chevron-right"
            ></wa-icon>
          `:""}
      ${this.hasSubmenu?M`
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
    `}};q.css=W1;w([X("#submenu")],q.prototype,"submenuElement",2);w([X("#link")],q.prototype,"linkElement",2);w([g({type:Boolean})],q.prototype,"active",2);w([g({reflect:!0})],q.prototype,"variant",2);w([g({reflect:!0})],q.prototype,"size",2);w([B("size")],q.prototype,"handleSizeChange",1);w([g({attribute:"checkbox-adjacent",type:Boolean,reflect:!0})],q.prototype,"checkboxAdjacent",2);w([g({attribute:"submenu-adjacent",type:Boolean,reflect:!0})],q.prototype,"submenuAdjacent",2);w([g()],q.prototype,"value",2);w([g({reflect:!0})],q.prototype,"type",2);w([g({type:Boolean})],q.prototype,"checked",2);w([g({type:Boolean,reflect:!0})],q.prototype,"disabled",2);w([g({type:Boolean,reflect:!0})],q.prototype,"submenuOpen",2);w([g({reflect:!0})],q.prototype,"href",2);w([g()],q.prototype,"target",2);w([g()],q.prototype,"rel",2);w([g()],q.prototype,"download",2);w([Fo()],q.prototype,"hasSubmenu",2);q=w([Y("wa-dropdown-item")],q);/*! Copyright 2026 Fonticons, Inc. - https://webawesome.com/license */var P1=class extends Event{constructor(){super("wa-reposition",{bubbles:!0,cancelable:!1,composed:!0})}};/*! Copyright 2026 Fonticons, Inc. - https://webawesome.com/license */var R1=y`
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
`;function _1(o){return wa(o)}function g0(o){return o.assignedSlot?o.assignedSlot:o.parentNode instanceof ShadowRoot?o.parentNode.host:o.parentNode}function wa(o){for(let a=o;a;a=g0(a))if(a instanceof Element&&getComputedStyle(a).display==="none")return null;for(let a=g0(o);a;a=g0(a)){if(!(a instanceof Element))continue;let n=getComputedStyle(a);if(n.display!=="contents"){if(n.position!=="static"||Go(n))return a;if(a.tagName==="BODY")return a}}return null}/*! Copyright 2026 Fonticons, Inc. - https://webawesome.com/license */function o4(o){return o!==null&&typeof o==="object"&&"getBoundingClientRect"in o&&("contextElement"in o?o instanceof Element:!0)}var la=Boolean(globalThis?.HTMLElement?.prototype.hasOwnProperty("popover")),x=class extends ${constructor(){super(...arguments);this.localize=new _(this),this.SUPPORTS_POPOVER=!1,this.active=!1,this.placement="top",this.boundary="viewport",this.distance=0,this.skidding=0,this.arrow=!1,this.arrowPlacement="anchor",this.arrowPadding=10,this.flip=!1,this.flipFallbackPlacements="",this.flipFallbackStrategy="best-fit",this.flipPadding=0,this.shift=!1,this.shiftPadding=0,this.autoSizePadding=0,this.hoverBridge=!1,this.updateHoverBridge=()=>{if(this.hoverBridge&&this.anchorEl&&this.popup){let o=this.anchorEl.getBoundingClientRect(),a=this.popup.getBoundingClientRect(),n=this.placement.includes("top")||this.placement.includes("bottom"),r=0,i=0,c=0,t=0,s=0,u=0,m=0,l=0;if(n)if(o.top<a.top)r=o.left,i=o.bottom,c=o.right,t=o.bottom,s=a.left,u=a.top,m=a.right,l=a.top;else r=a.left,i=a.bottom,c=a.right,t=a.bottom,s=o.left,u=o.top,m=o.right,l=o.top;else if(o.left<a.left)r=o.right,i=o.top,c=a.left,t=a.top,s=o.right,u=o.bottom,m=a.left,l=a.bottom;else r=a.right,i=a.top,c=o.left,t=o.top,s=a.right,u=a.bottom,m=o.left,l=o.bottom;this.style.setProperty("--hover-bridge-top-left-x",`${r}px`),this.style.setProperty("--hover-bridge-top-left-y",`${i}px`),this.style.setProperty("--hover-bridge-top-right-x",`${c}px`),this.style.setProperty("--hover-bridge-top-right-y",`${t}px`),this.style.setProperty("--hover-bridge-bottom-left-x",`${s}px`),this.style.setProperty("--hover-bridge-bottom-left-y",`${u}px`),this.style.setProperty("--hover-bridge-bottom-right-x",`${m}px`),this.style.setProperty("--hover-bridge-bottom-right-y",`${l}px`)}}}async connectedCallback(){super.connectedCallback(),await this.updateComplete,this.SUPPORTS_POPOVER=la,this.start()}disconnectedCallback(){super.disconnectedCallback(),this.stop()}async updated(o){if(super.updated(o),o.has("active"))if(this.active)this.start();else this.stop();if(o.has("anchor"))this.handleAnchorChange();if(this.active)await this.updateComplete,this.reposition()}async handleAnchorChange(){if(await this.stop(),this.anchor&&typeof this.anchor==="string"){let o=this.getRootNode();this.anchorEl=o.getElementById(this.anchor)}else if(this.anchor instanceof Element||o4(this.anchor))this.anchorEl=this.anchor;else this.anchorEl=this.querySelector('[slot="anchor"]');if(this.anchorEl instanceof HTMLSlotElement)this.anchorEl=this.anchorEl.assignedElements({flatten:!0})[0];if(this.anchorEl)this.start()}start(){if(!this.anchorEl||!this.active||!this.isConnected)return;this.popup?.showPopover?.(),this.cleanup=Z2(this.anchorEl,this.popup,()=>{this.reposition()})}async stop(){return new Promise((o)=>{if(this.popup?.hidePopover?.(),this.cleanup)this.cleanup(),this.cleanup=void 0,this.removeAttribute("data-current-placement"),this.style.removeProperty("--auto-size-available-width"),this.style.removeProperty("--auto-size-available-height"),requestAnimationFrame(()=>o());else o()})}reposition(){if(!this.active||!this.anchorEl||!this.popup)return;let o=[J2({mainAxis:this.distance,crossAxis:this.skidding})];if(this.sync)o.push(u0({apply:({rects:r})=>{let i=this.sync==="width"||this.sync==="both",c=this.sync==="height"||this.sync==="both";this.popup.style.width=i?`${r.reference.width}px`:"",this.popup.style.height=c?`${r.reference.height}px`:""}}));else this.popup.style.width="",this.popup.style.height="";let a;if(this.SUPPORTS_POPOVER&&!o4(this.anchor)&&this.boundary==="scroll")a=so(this.anchorEl).filter((r)=>r instanceof Element);if(this.flip)o.push(Q2({boundary:this.flipBoundary||a,fallbackPlacements:this.flipFallbackPlacements,fallbackStrategy:this.flipFallbackStrategy==="best-fit"?"bestFit":"initialPlacement",padding:this.flipPadding}));if(this.shift)o.push(B2({boundary:this.shiftBoundary||a,padding:this.shiftPadding}));if(this.autoSize)o.push(u0({boundary:this.autoSizeBoundary||a,padding:this.autoSizePadding,apply:({availableWidth:r,availableHeight:i})=>{if(this.autoSize==="vertical"||this.autoSize==="both")this.style.setProperty("--auto-size-available-height",`${i}px`);else this.style.removeProperty("--auto-size-available-height");if(this.autoSize==="horizontal"||this.autoSize==="both")this.style.setProperty("--auto-size-available-width",`${r}px`);else this.style.removeProperty("--auto-size-available-width")}}));else this.style.removeProperty("--auto-size-available-width"),this.style.removeProperty("--auto-size-available-height");if(this.arrow)o.push(D1({element:this.arrowEl,padding:this.arrowPadding}));let n=this.SUPPORTS_POPOVER?(r)=>c2.getOffsetParent(r,_1):c2.getOffsetParent;X2(this.anchorEl,this.popup,{placement:this.placement,middleware:o,strategy:this.SUPPORTS_POPOVER?"absolute":"fixed",platform:{...c2,getOffsetParent:n}}).then(({x:r,y:i,middlewareData:c,placement:t})=>{let s=this.localize.dir()==="rtl",u={top:"bottom",right:"left",bottom:"top",left:"right"}[t.split("-")[0]];if(this.setAttribute("data-current-placement",t),Object.assign(this.popup.style,{left:`${r}px`,top:`${i}px`}),this.arrow){let m=c.arrow.x,l=c.arrow.y,b="",h="",v="",f="";if(this.arrowPlacement==="start"){let d=typeof m==="number"?`calc(${this.arrowPadding}px - var(--arrow-padding-offset))`:"";b=typeof l==="number"?`calc(${this.arrowPadding}px - var(--arrow-padding-offset))`:"",h=s?d:"",f=s?"":d}else if(this.arrowPlacement==="end"){let d=typeof m==="number"?`calc(${this.arrowPadding}px - var(--arrow-padding-offset))`:"";h=s?"":d,f=s?d:"",v=typeof l==="number"?`calc(${this.arrowPadding}px - var(--arrow-padding-offset))`:""}else if(this.arrowPlacement==="center")f=typeof m==="number"?"calc(50% - var(--arrow-size-diagonal))":"",b=typeof l==="number"?"calc(50% - var(--arrow-size-diagonal))":"";else f=typeof m==="number"?`${m}px`:"",b=typeof l==="number"?`${l}px`:"";Object.assign(this.arrowEl.style,{top:b,right:h,bottom:v,left:f,[u]:"calc(var(--arrow-base-offset) - var(--arrow-size-diagonal))"})}}),requestAnimationFrame(()=>this.updateHoverBridge()),this.dispatchEvent(new P1)}render(){return M`
      <slot name="anchor" @slotchange=${this.handleAnchorChange}></slot>

      <span
        part="hover-bridge"
        class=${eo({"popup-hover-bridge":!0,"popup-hover-bridge-visible":this.hoverBridge&&this.active})}
      ></span>

      <div
        popover="manual"
        part="popup"
        class=${eo({popup:!0,"popup-active":this.active,"popup-fixed":!this.SUPPORTS_POPOVER,"popup-has-arrow":this.arrow})}
      >
        <slot></slot>
        ${this.arrow?M`<div part="arrow" class="arrow" role="presentation"></div>`:""}
      </div>
    `}};x.css=R1;w([X(".popup")],x.prototype,"popup",2);w([X(".arrow")],x.prototype,"arrowEl",2);w([g({attribute:!1,type:Boolean})],x.prototype,"SUPPORTS_POPOVER",2);w([g()],x.prototype,"anchor",2);w([g({type:Boolean,reflect:!0})],x.prototype,"active",2);w([g({reflect:!0})],x.prototype,"placement",2);w([g()],x.prototype,"boundary",2);w([g({type:Number})],x.prototype,"distance",2);w([g({type:Number})],x.prototype,"skidding",2);w([g({type:Boolean})],x.prototype,"arrow",2);w([g({attribute:"arrow-placement"})],x.prototype,"arrowPlacement",2);w([g({attribute:"arrow-padding",type:Number})],x.prototype,"arrowPadding",2);w([g({type:Boolean})],x.prototype,"flip",2);w([g({attribute:"flip-fallback-placements",converter:{fromAttribute:(o)=>{return o.split(" ").map((a)=>a.trim()).filter((a)=>a!=="")},toAttribute:(o)=>{return o.join(" ")}}})],x.prototype,"flipFallbackPlacements",2);w([g({attribute:"flip-fallback-strategy"})],x.prototype,"flipFallbackStrategy",2);w([g({type:Object})],x.prototype,"flipBoundary",2);w([g({attribute:"flip-padding",type:Number})],x.prototype,"flipPadding",2);w([g({type:Boolean})],x.prototype,"shift",2);w([g({type:Object})],x.prototype,"shiftBoundary",2);w([g({attribute:"shift-padding",type:Number})],x.prototype,"shiftPadding",2);w([g({attribute:"auto-size"})],x.prototype,"autoSize",2);w([g()],x.prototype,"sync",2);w([g({type:Object})],x.prototype,"autoSizeBoundary",2);w([g({attribute:"auto-size-padding",type:Number})],x.prototype,"autoSizePadding",2);w([g({attribute:"hover-bridge",type:Boolean})],x.prototype,"hoverBridge",2);x=w([Y("wa-popup")],x);/*! Copyright 2026 Fonticons, Inc. - https://webawesome.com/license *//*! Copyright 2026 Fonticons, Inc. - https://webawesome.com/license *//*! Copyright 2026 Fonticons, Inc. - https://webawesome.com/license */var a4=y`
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
`;/*! Copyright 2026 Fonticons, Inc. - https://webawesome.com/license */var vo=class extends ${constructor(){super(...arguments);this.hasSlotController=new go(this,"[default]"),this.orientation="horizontal",this.withLabel=!1,this.labelPlacement="center"}connectedCallback(){super.connectedCallback(),this.setAttribute("role","separator")}willUpdate(o){this.withLabel=this.hasSlotController.test("[default]","withLabel"),super.willUpdate(o)}handleVerticalChange(){this.setAttribute("aria-orientation",this.orientation)}handleSlotChange(){if(this.internals)this.internals.ariaLabel=this.textContent?.trim()||null}render(){return M`
      <div part="label" class="label">
        <slot @slotchange=${this.handleSlotChange}></slot>
      </div>
    `}};vo.css=a4;w([g({reflect:!0})],vo.prototype,"orientation",2);w([g({attribute:"with-label",type:Boolean,reflect:!0})],vo.prototype,"withLabel",2);w([g({attribute:"label-placement",reflect:!0})],vo.prototype,"labelPlacement",2);w([B("orientation")],vo.prototype,"handleVerticalChange",1);vo=w([Y("wa-divider")],vo);/*! Copyright 2026 Fonticons, Inc. - https://webawesome.com/license *//*! Copyright 2026 Fonticons, Inc. - https://webawesome.com/license */var n4=y`
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
`;/*! Copyright 2026 Fonticons, Inc. - https://webawesome.com/license */var t2=class extends ${constructor(){super(...arguments);this.effect="none"}render(){return M` <div part="indicator" class="indicator"></div> `}};t2.css=n4;w([g({reflect:!0})],t2.prototype,"effect",2);t2=w([Y("wa-skeleton")],t2);/*! Copyright 2026 Fonticons, Inc. - https://webawesome.com/license *//*! Copyright 2026 Fonticons, Inc. - https://webawesome.com/license */var ua={$code:"es",$name:"Español",$dir:"ltr",allTagsRemoved:"Se eliminaron todas las etiquetas",am:"AM",autosizeColumn:"Ajustar el tamaño de la columna al contenido",captions:"Subtítulos",carousel:"Carrusel",chooseDate:"Elegir fecha",chooseDecade:"Elegir década",chooseMonth:"Elegir mes",chooseTime:"Elegir hora",chooseYear:"Elegir año",clearEntry:"Borrar entrada",clearFilter:"Borrar filtro",clearSort:"Borrar orden",close:"Cerrar",closeCalendar:"Cerrar calendario",closeTimeInput:"Cerrar selector de hora",collapseRow:"Contraer fila",columnMenu:"Opciones de columna",columnMovedToPosition:(o,a,n)=>`${o} movida a la posición ${a} de ${n}`,columns:"Columnas",compactPageXOfY:(o,a)=>`${o} de ${a}`,completed:"Completado",copied:"Copiado",copy:"Copiar",createOption:(o)=>`Crear "${o}"`,currentlyPlaying:"reproduciendo actualmente",currentValue:"Valor actual",date:"Fecha",datePickerKeyboardHelp:"Use las teclas de flecha para cambiar los valores; presione Alt+Flecha abajo para abrir el calendario.",day:"Día",dayPeriod:"AM/PM",decrement:"Disminuir",deselectAllRows:"Deseleccionar todas las filas",disabled:"Deshabilitado",dropFileHere:"Drop file here or click to browse",dropFilesHere:"Drop files here or click to browse",empty:"Vacío",endDate:"Fecha de fin",enterFullscreen:"Entrar en pantalla completa",error:"Error",exitFullscreen:"Salir de pantalla completa",expandRow:"Expandir fila",filterByColumn:(o)=>`Filtrar por ${o}`,filterFrom:"Desde",filterMax:"Máx",filterMin:"Mín",filterTo:"Hasta",firstPage:"Primera página",goToSlide:(o,a)=>`Ir a la diapositiva ${o} de ${a}`,hideColumn:"Ocultar columna",hidePassword:"Ocultar contraseña",hour:"Hora",incompleteDate:"Introduzca una fecha válida.",increment:"Aumentar",jumpBackwardX:(o)=>{if(o===1)return"Retroceder 1 página";return`Retroceder ${o} páginas`},jumpForwardX:(o)=>{if(o===1)return"Avanzar 1 página";return`Avanzar ${o} páginas`},lastPage:"Última página",loading:"Cargando",locked:"Bloqueado",minute:"Minuto",month:"Mes",moreOptions:"Más opciones",mute:"Silenciar",nextDecade:"Década siguiente",nextMonth:"Mes siguiente",nextPage:"Página siguiente",nextSlide:"Siguiente diapositiva",nextVideo:"Siguiente vídeo",nextYear:"Año siguiente",noData:"No hay datos",noOptions:"No hay opciones",noResults:"No hay resultados coincidentes",notCompleted:"No completado",now:"Ahora",numCharacters:(o)=>{if(o===1)return"1 carácter";return`${o} caracteres`},numCharactersRemaining:(o)=>{if(o===1)return"1 carácter restante";return`${o} caracteres restantes`},numOptionsAvailable:(o)=>{if(o===0)return"No hay opciones disponibles";if(o===1)return"1 opción disponible";return`${o} opciones disponibles`},numOptionsSelected:(o)=>{if(o===0)return"No hay opciones seleccionadas";if(o===1)return"1 opción seleccionada";return`${o} opción seleccionada`},numRowsCopied:(o)=>o===1?"1 fila copiada":`${o} filas copiadas`,numRowsSelected:(o)=>o===1?"1 fila seleccionada":`${o} filas seleccionadas`,optionPosition:(o,a,n)=>`${o}, ${a} de ${n}`,optionsLoadError:"No se pudieron cargar las opciones",pageXOfY:(o,a)=>`Página ${o} de ${a}`,pagination:"Paginación",pause:"Pausar",pauseAnimation:"Pausar animación",pictureInPicture:"Imagen en imagen",pinLeft:"Fijar a la izquierda",pinRight:"Fijar a la derecha",play:"Reproducir",playAnimation:"Reproducir animación",playbackSpeed:"Velocidad de reproducción",playlist:"Lista de reproducción",pm:"PM",previousDecade:"Década anterior",previousMonth:"Mes anterior",previousPage:"Página anterior",previousSlide:"Diapositiva anterior",previousVideo:"Vídeo anterior",previousYear:"Año anterior",progress:"Progreso",rangeTooLong:(o)=>{if(o===1)return"Seleccione un intervalo no mayor de 1 día";return`Seleccione un intervalo no mayor de ${o} días`},rangeTooShort:(o)=>{if(o===1)return"Seleccione un intervalo de al menos 1 día";return`Seleccione un intervalo de al menos ${o} días`},readonly:"Solo lectura",remove:"Eliminar",resetColumns:"Restablecer columnas",resize:"Cambiar el tamaño",resizeColumn:"Cambiar el tamaño de la columna",rowsPerPage:"Filas por página",scrollableRegion:"Región desplazable",scrollToEnd:"Desplazarse hasta el final",scrollToStart:"Desplazarse al inicio",search:"Buscar",second:"Segundo",seek:"Buscar",seekProgress:(o,a)=>`${o} de ${a}`,selectAColorFromTheScreen:"Seleccione un color de la pantalla",selectAllRows:"Seleccionar todas las filas",selected:"Seleccionado",selectedDateLabel:(o)=>`Seleccionado: ${o}`,selectedRangeLabel:(o)=>`Intervalo seleccionado: ${o}`,selectGroup:"Seleccionar grupo",selectionCleared:"Selección borrada",selectRow:"Seleccionar fila",showingNofMRows:(o,a)=>`Mostrando ${o} de ${a} filas`,showingXtoYofZ:(o,a,n)=>`${o}–${a} de ${n}`,showPassword:"Mostrar contraseña",slideNum:(o)=>`Diapositiva ${o}`,sortAscending:"Ordenar de forma ascendente",sortColumn:"Ordenar columna",sortDescending:"Ordenar de forma descendente",startDate:"Fecha de inicio",steps:"Pasos",stepXOfY:(o,a)=>`Paso ${o} de ${a}`,tagAdded:(o)=>`Se añadió ${o}`,tagAlreadyAdded:(o)=>`${o} ya existe`,tagInputKeyboardHelp:"Pulse Retroceso o Suprimir para eliminar esta etiqueta.",tagRemoved:(o)=>`Se eliminó ${o}`,time:"Hora",timeInputKeyboardHelp:"Use las teclas de flecha para cambiar los valores; presione Alt+Flecha abajo para abrir el selector de hora.",today:"Hoy",toggleColorFormat:"Alternar formato de color",tooFewTags:(o)=>o===1?"Añada al menos 1 etiqueta":`Añada al menos ${o} etiquetas`,tooManyTags:(o)=>o===1?"Añada como máximo 1 etiqueta":`Añada como máximo ${o} etiquetas`,unmute:"Activar sonido",unpin:"Desfijar",unpinColumn:"Desfijar columna",videoPlayer:"Reproductor de vídeo",volume:"Volumen",year:"Año",zoomIn:"Acercar",zoomOut:"Alejar"};Mo(ua);
