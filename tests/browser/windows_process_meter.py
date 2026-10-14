"""Windows process-tree CPU time and memory sampler (no browser heap proxy).

Working set includes shared pages; summing processes can count them twice.
Private bytes are committed private memory, not resident RAM. Sampled peaks
are lower bounds at the stated interval. Handles retain final CPU times after
children exit. No forced GC, working-set trimming, or priority changes.
"""
import ctypes as c
from ctypes import wintypes as w
import threading,time,os

k=c.WinDLL('kernel32',use_last_error=True);ps=c.WinDLL('psapi',use_last_error=True)
class Entry(c.Structure):
    _fields_=[('size',w.DWORD),('usage',w.DWORD),('pid',w.DWORD),('heap',c.c_size_t),('module',w.DWORD),('threads',w.DWORD),('parent',w.DWORD),('priority',w.LONG),('flags',w.DWORD),('exe',w.WCHAR*260)]
class Memory(c.Structure):
    _fields_=[('cb',w.DWORD),('faults',w.DWORD)]+[(name,c.c_size_t) for name in ['peakWorkingSet','workingSet','peakPaged','paged','peakNonpaged','nonpaged','pagefile','peakPagefile','privateBytes']]
k.CreateToolhelp32Snapshot.argtypes=[w.DWORD,w.DWORD];k.CreateToolhelp32Snapshot.restype=w.HANDLE
k.Process32FirstW.argtypes=[w.HANDLE,c.POINTER(Entry)];k.Process32NextW.argtypes=[w.HANDLE,c.POINTER(Entry)]
k.OpenProcess.argtypes=[w.DWORD,w.BOOL,w.DWORD];k.OpenProcess.restype=w.HANDLE
k.GetProcessTimes.argtypes=[w.HANDLE]+[c.POINTER(w.FILETIME)]*4
k.GetExitCodeProcess.argtypes=[w.HANDLE,c.POINTER(w.DWORD)]
k.CloseHandle.argtypes=[w.HANDLE]
ps.GetProcessMemoryInfo.argtypes=[w.HANDLE,c.POINTER(Memory),w.DWORD]

def processes():
    handle=k.CreateToolhelp32Snapshot(2,0)
    if handle==c.c_void_p(-1).value:raise c.WinError(c.get_last_error())
    try:
        row=Entry();row.size=c.sizeof(row);ok=k.Process32FirstW(handle,c.byref(row));result={}
        while ok:
            result[row.pid]=row.parent;ok=k.Process32NextW(handle,c.byref(row))
        return result
    finally:k.CloseHandle(handle)

class ProcessMeter:
    def __init__(self,root,interval=.25):
        self.root=root;self.interval=interval;self.handles={};self.samples=[];self.errors=[];self.transient_exits=[];self.stop_event=threading.Event();self.lock=threading.Lock();self.started=time.perf_counter()
        self.thread=threading.Thread(target=self.loop,daemon=True);self.thread.start()
    def sample(self):
        tree=processes();ids={self.root};changed=True
        while changed:
            old=len(ids);ids.update(pid for pid,parent in tree.items() if parent in ids);changed=len(ids)!=old
        for pid in ids:
            if pid not in self.handles:
                handle=k.OpenProcess(0x410,False,pid)
                if handle:self.handles[pid]=handle
                elif pid in tree:
                    error=c.get_last_error()
                    # ERROR_INVALID_PARAMETER: the process exited between the
                    # snapshot and OpenProcess. Its sub-interval CPU is unknown.
                    if error==87:self.transient_exits.append(pid)
                    else:self.errors.append({'pid':pid,'error':error})
        cpu=0.;rss=0;private=0;active=0
        for pid,handle in self.handles.items():
            created=w.FILETIME();exited=w.FILETIME();kernel=w.FILETIME();user=w.FILETIME()
            if k.GetProcessTimes(handle,c.byref(created),c.byref(exited),c.byref(kernel),c.byref(user)):
                cpu+=((kernel.dwHighDateTime<<32)+kernel.dwLowDateTime+(user.dwHighDateTime<<32)+user.dwLowDateTime)/1e7
            status=w.DWORD()
            if not k.GetExitCodeProcess(handle,c.byref(status)) or status.value!=259:continue
            active+=1;mem=Memory();mem.cb=c.sizeof(mem)
            if ps.GetProcessMemoryInfo(handle,c.byref(mem),mem.cb):rss+=mem.workingSet;private+=mem.privateBytes
            else:
                error=c.get_last_error();k.GetExitCodeProcess(handle,c.byref(status))
                if status.value==259:self.errors.append({'pid':pid,'memoryError':error})
        return {'t':time.perf_counter()-self.started,'cpuSeconds':cpu,'workingSetBytes':rss,'privateBytes':private,'processes':active}
    def loop(self):
        while not self.stop_event.is_set():
            try:
                value=self.sample()
                with self.lock:self.samples.append(value)
            except Exception as error:self.errors.append({'exception':str(error)})
            self.stop_event.wait(self.interval)
    def mark(self):
        with self.lock:return dict(self.samples[-1]) if self.samples else None
    def stop(self):
        self.stop_event.set();self.thread.join()
        for handle in self.handles.values():k.CloseHandle(handle)
    def summarize(self,start,end):
        rows=[s for s in self.samples if start['t']<=s['t']<=end['t']]
        seconds=end['t']-start['t'];cpu=end['cpuSeconds']-start['cpuSeconds']
        return {'wallSeconds':seconds,'cpuSeconds':cpu,'averageCpuCorePercent':cpu/seconds*100,'averageMachineCpuPercent':cpu/seconds/os.cpu_count()*100,'peakWorkingSetMiB':max(s['workingSetBytes'] for s in rows)/2**20,'peakPrivateMiB':max(s['privateBytes'] for s in rows)/2**20,'samples':len(rows)}
