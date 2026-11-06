export namespace agent {
	
	export class LaunchRequest {
	    projectId: string;
	    name: string;
	    provider: string;
	    model: string;
	    permissionMode: string;
	    task: string;
	
	    static createFrom(source: any = {}) {
	        return new LaunchRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.projectId = source["projectId"];
	        this.name = source["name"];
	        this.provider = source["provider"];
	        this.model = source["model"];
	        this.permissionMode = source["permissionMode"];
	        this.task = source["task"];
	    }
	}

}

export namespace main {
	
	export class FileDiffResult {
	    path: string;
	    recorded: string;
	    gitDiff: string;
	    gitNotice: string;
	
	    static createFrom(source: any = {}) {
	        return new FileDiffResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.recorded = source["recorded"];
	        this.gitDiff = source["gitDiff"];
	        this.gitNotice = source["gitNotice"];
	    }
	}
	export class Snapshot {
	    projects: model.ProjectSummary[];
	    agents: model.AgentSummary[];
	    providers: provider.Info[];
	    statePath: string;
	    storageError: string;
	    version: string;
	
	    static createFrom(source: any = {}) {
	        return new Snapshot(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.projects = this.convertValues(source["projects"], model.ProjectSummary);
	        this.agents = this.convertValues(source["agents"], model.AgentSummary);
	        this.providers = this.convertValues(source["providers"], provider.Info);
	        this.statePath = source["statePath"];
	        this.storageError = source["storageError"];
	        this.version = source["version"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

export namespace model {
	
	export class ActivityEntry {
	    id: number;
	    kind: string;
	    text: string;
	    at: number;
	
	    static createFrom(source: any = {}) {
	        return new ActivityEntry(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.kind = source["kind"];
	        this.text = source["text"];
	        this.at = source["at"];
	    }
	}
	export class Issue {
	    id: number;
	    level: string;
	    text: string;
	    at: number;
	
	    static createFrom(source: any = {}) {
	        return new Issue(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.level = source["level"];
	        this.text = source["text"];
	        this.at = source["at"];
	    }
	}
	export class ToolCall {
	    id: string;
	    name: string;
	    summary: string;
	    input: string;
	    output: string;
	    status: string;
	    at: number;
	
	    static createFrom(source: any = {}) {
	        return new ToolCall(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.summary = source["summary"];
	        this.input = source["input"];
	        this.output = source["output"];
	        this.status = source["status"];
	        this.at = source["at"];
	    }
	}
	export class Message {
	    id: string;
	    role: string;
	    text: string;
	    streaming: boolean;
	    at: number;
	
	    static createFrom(source: any = {}) {
	        return new Message(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.role = source["role"];
	        this.text = source["text"];
	        this.streaming = source["streaming"];
	        this.at = source["at"];
	    }
	}
	export class ModelOption {
	    id: string;
	    label: string;
	    group: string;
	    description: string;
	
	    static createFrom(source: any = {}) {
	        return new ModelOption(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.label = source["label"];
	        this.group = source["group"];
	        this.description = source["description"];
	    }
	}
	export class PermissionMode {
	    id: string;
	    label: string;
	    description: string;
	
	    static createFrom(source: any = {}) {
	        return new PermissionMode(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.label = source["label"];
	        this.description = source["description"];
	    }
	}
	export class Capabilities {
	    stop: boolean;
	    resume: boolean;
	    send: boolean;
	    cost: boolean;
	    streaming: boolean;
	    permissionModes: PermissionMode[];
	    models: ModelOption[];
	
	    static createFrom(source: any = {}) {
	        return new Capabilities(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.stop = source["stop"];
	        this.resume = source["resume"];
	        this.send = source["send"];
	        this.cost = source["cost"];
	        this.streaming = source["streaming"];
	        this.permissionModes = this.convertValues(source["permissionModes"], PermissionMode);
	        this.models = this.convertValues(source["models"], ModelOption);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class FileOpRecord {
	    op: string;
	    tool: string;
	    at: number;
	    diff?: string;
	
	    static createFrom(source: any = {}) {
	        return new FileOpRecord(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.op = source["op"];
	        this.tool = source["tool"];
	        this.at = source["at"];
	        this.diff = source["diff"];
	    }
	}
	export class FileActivity {
	    path: string;
	    reads: number;
	    writes: number;
	    state: string;
	    lastOp: string;
	    lastAt: number;
	    ops?: FileOpRecord[];
	
	    static createFrom(source: any = {}) {
	        return new FileActivity(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.reads = source["reads"];
	        this.writes = source["writes"];
	        this.state = source["state"];
	        this.lastOp = source["lastOp"];
	        this.lastAt = source["lastAt"];
	        this.ops = this.convertValues(source["ops"], FileOpRecord);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class Usage {
	    inputTokens: number;
	    outputTokens: number;
	    cacheReadTokens: number;
	    costUsd: number;
	
	    static createFrom(source: any = {}) {
	        return new Usage(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.inputTokens = source["inputTokens"];
	        this.outputTokens = source["outputTokens"];
	        this.cacheReadTokens = source["cacheReadTokens"];
	        this.costUsd = source["costUsd"];
	    }
	}
	export class Point {
	    x: number;
	    y: number;
	
	    static createFrom(source: any = {}) {
	        return new Point(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.x = source["x"];
	        this.y = source["y"];
	    }
	}
	export class AgentDetail {
	    id: string;
	    projectId: string;
	    name: string;
	    provider: string;
	    providerName: string;
	    model: string;
	    task: string;
	    permissionMode: string;
	    status: string;
	    statusDetail: string;
	    sessionId: string;
	    running: boolean;
	    position?: Point;
	    createdAt: number;
	    updatedAt: number;
	    runStartedAt: number;
	    turns: number;
	    toolCalls: number;
	    usage: Usage;
	    lastError: string;
	    fileCount: number;
	    writeCount: number;
	    issueCount: number;
	    recentFiles: FileActivity[];
	    capabilities: Capabilities;
	    messages: Message[];
	    tools: ToolCall[];
	    activity: ActivityEntry[];
	    issues: Issue[];
	    files: FileActivity[];
	
	    static createFrom(source: any = {}) {
	        return new AgentDetail(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.projectId = source["projectId"];
	        this.name = source["name"];
	        this.provider = source["provider"];
	        this.providerName = source["providerName"];
	        this.model = source["model"];
	        this.task = source["task"];
	        this.permissionMode = source["permissionMode"];
	        this.status = source["status"];
	        this.statusDetail = source["statusDetail"];
	        this.sessionId = source["sessionId"];
	        this.running = source["running"];
	        this.position = this.convertValues(source["position"], Point);
	        this.createdAt = source["createdAt"];
	        this.updatedAt = source["updatedAt"];
	        this.runStartedAt = source["runStartedAt"];
	        this.turns = source["turns"];
	        this.toolCalls = source["toolCalls"];
	        this.usage = this.convertValues(source["usage"], Usage);
	        this.lastError = source["lastError"];
	        this.fileCount = source["fileCount"];
	        this.writeCount = source["writeCount"];
	        this.issueCount = source["issueCount"];
	        this.recentFiles = this.convertValues(source["recentFiles"], FileActivity);
	        this.capabilities = this.convertValues(source["capabilities"], Capabilities);
	        this.messages = this.convertValues(source["messages"], Message);
	        this.tools = this.convertValues(source["tools"], ToolCall);
	        this.activity = this.convertValues(source["activity"], ActivityEntry);
	        this.issues = this.convertValues(source["issues"], Issue);
	        this.files = this.convertValues(source["files"], FileActivity);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class AgentSummary {
	    id: string;
	    projectId: string;
	    name: string;
	    provider: string;
	    providerName: string;
	    model: string;
	    task: string;
	    permissionMode: string;
	    status: string;
	    statusDetail: string;
	    sessionId: string;
	    running: boolean;
	    position?: Point;
	    createdAt: number;
	    updatedAt: number;
	    runStartedAt: number;
	    turns: number;
	    toolCalls: number;
	    usage: Usage;
	    lastError: string;
	    fileCount: number;
	    writeCount: number;
	    issueCount: number;
	    recentFiles: FileActivity[];
	    capabilities: Capabilities;
	
	    static createFrom(source: any = {}) {
	        return new AgentSummary(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.projectId = source["projectId"];
	        this.name = source["name"];
	        this.provider = source["provider"];
	        this.providerName = source["providerName"];
	        this.model = source["model"];
	        this.task = source["task"];
	        this.permissionMode = source["permissionMode"];
	        this.status = source["status"];
	        this.statusDetail = source["statusDetail"];
	        this.sessionId = source["sessionId"];
	        this.running = source["running"];
	        this.position = this.convertValues(source["position"], Point);
	        this.createdAt = source["createdAt"];
	        this.updatedAt = source["updatedAt"];
	        this.runStartedAt = source["runStartedAt"];
	        this.turns = source["turns"];
	        this.toolCalls = source["toolCalls"];
	        this.usage = this.convertValues(source["usage"], Usage);
	        this.lastError = source["lastError"];
	        this.fileCount = source["fileCount"];
	        this.writeCount = source["writeCount"];
	        this.issueCount = source["issueCount"];
	        this.recentFiles = this.convertValues(source["recentFiles"], FileActivity);
	        this.capabilities = this.convertValues(source["capabilities"], Capabilities);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class ConflictAgent {
	    id: string;
	    name: string;
	
	    static createFrom(source: any = {}) {
	        return new ConflictAgent(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	    }
	}
	export class Conflict {
	    path: string;
	    agents: ConflictAgent[];
	
	    static createFrom(source: any = {}) {
	        return new Conflict(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.agents = this.convertValues(source["agents"], ConflictAgent);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	
	
	
	
	
	
	
	export class ProjectSummary {
	    id: string;
	    name: string;
	    repoPath: string;
	    createdAt: number;
	    icon?: string;
	    iconRev?: number;
	    agentCount: number;
	    runningCount: number;
	    conflicts: Conflict[];
	
	    static createFrom(source: any = {}) {
	        return new ProjectSummary(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.repoPath = source["repoPath"];
	        this.createdAt = source["createdAt"];
	        this.icon = source["icon"];
	        this.iconRev = source["iconRev"];
	        this.agentCount = source["agentCount"];
	        this.runningCount = source["runningCount"];
	        this.conflicts = this.convertValues(source["conflicts"], Conflict);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	

}

export namespace provider {
	
	export class Info {
	    id: string;
	    name: string;
	    available: boolean;
	    path: string;
	    hint: string;
	    capabilities: model.Capabilities;
	
	    static createFrom(source: any = {}) {
	        return new Info(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.available = source["available"];
	        this.path = source["path"];
	        this.hint = source["hint"];
	        this.capabilities = this.convertValues(source["capabilities"], model.Capabilities);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

