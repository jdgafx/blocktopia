export const QUALITY_LEVELS=['low','balanced','high'];
export class AutoQuality {
  constructor({cores=4,memory=4,mobile=false}={}){
    this.level=cores<=4||memory<=4||mobile?0:1;
    this.enabled=true;this.samples=[];this.elapsed=0;this.cooldown=8;
  }
  sample(seconds,active=true){
    if(!this.enabled||!active||!Number.isFinite(seconds)||seconds<=0){this.samples=[];this.elapsed=0;return null;}
    seconds=Math.min(seconds,.5);
    this.cooldown=Math.max(0,this.cooldown-seconds);this.samples.push(seconds);this.elapsed+=seconds;
    if(this.elapsed<4)return null;
    const sorted=this.samples.sort((a,b)=>a-b),p75=sorted[Math.floor(sorted.length*.75)];
    this.samples=[];this.elapsed=0;
    if(this.cooldown)return null;
    const next=p75>1/40?Math.max(0,this.level-1):p75<1/58?Math.min(2,this.level+1):this.level;
    if(next===this.level)return null;
    this.level=next;this.cooldown=next===2?30:16;
    return QUALITY_LEVELS[next];
  }
}
