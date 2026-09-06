// Two workers leave capacity for the browser, networking and user applications.
export class TerrainJobs {
  constructor(count = Math.max(1,Math.min(2,(navigator.hardwareConcurrency || 2)-1))) {
    this.queue = []; this.nextId = 0; this.closed = false;
    this.metrics = { completed:0, lastMeshMs:0, lastGenerationMs:0, maxMeshMs:0, sharedSnapshots:0 };
    this.slots = Array.from({length:count},()=>{
      const slot = { worker:new Worker(new URL('./terrain-worker.js',import.meta.url),{type:'module'}), job:null };
      slot.worker.onmessage = ({data})=>this.onResult(slot,data);
      slot.worker.onmessageerror = ()=>this.fail(new Error('Terrain worker data could not be decoded'));
      slot.worker.onerror = event => {event.preventDefault();this.fail(new Error(event.message || 'Terrain worker failed'));};
      return slot;
    });
  }
  onResult(slot,data) {
    const job=slot.job;
    if(!job||data.id!==job.id)return;
    slot.job=null;
    if(data.error)job.reject(new Error(data.error));
    else{
      this.metrics.completed++;
      if(job.type==='mesh'){this.metrics.lastMeshMs=data.milliseconds;this.metrics.maxMeshMs=Math.max(this.metrics.maxMeshMs,data.milliseconds);}
      else this.metrics.lastGenerationMs=data.milliseconds;
      job.resolve(data.result);
    }
    this.pump();
  }
  run(type,payload) {
    if(this.closed)return Promise.reject(new Error('Terrain workers are unavailable'));
    if(type==='mesh'&&typeof SharedArrayBuffer!=='undefined'&&payload.data.buffer instanceof SharedArrayBuffer)this.metrics.sharedSnapshots++;
    return new Promise((resolve,reject)=>{
      const job={id:++this.nextId,type,payload,resolve,reject};
      if(type==='mesh')this.queue.unshift(job);else this.queue.push(job);
      this.pump();
    });
  }
  pump() {
    for(const slot of this.slots)if(!slot.job&&this.queue.length){
      const job=slot.job=this.queue.shift();
      const transfer=job.type==='mesh'&&job.payload.data.buffer instanceof ArrayBuffer?[job.payload.data.buffer]:[];
      slot.worker.postMessage({id:job.id,type:job.type,payload:job.payload},transfer);
    }
  }
  cancelOutside(keys) {
    this.queue=this.queue.filter(job=>{
      if(keys.has(`${job.payload.cx},${job.payload.cz}`))return true;
      job.resolve(null);return false;
    });
  }
  fail(error) {
    this.closed=true;
    for(const slot of this.slots){slot.job?.reject(error);slot.job=null;slot.worker.terminate();}
    this.queue.splice(0).forEach(job=>job.reject(error));
  }
  dispose(){this.fail(new Error('Terrain jobs stopped'));}
}
