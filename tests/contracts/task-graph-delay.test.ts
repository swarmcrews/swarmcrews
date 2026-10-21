import { describe, expect, it } from "vitest";
import { semanticGraphDependencySchema } from "../../shared/task-graph-planning-contracts.ts";
import { taskEdgeSchema } from "../../shared/task-graph-contracts.ts";
import { SemanticGraphDocumentDraft } from "../../server/task-graph/graph-document.ts";

describe("graph dependency delay contract",()=>{
  it.each([0,300_000,604_800_000])("accepts %i milliseconds through semantic and canonical schemas",delayMs=>{
    const dependency=semanticGraphDependencySchema.parse({stepKey:"upstream",delayMs});
    expect(dependency.delayMs).toBe(delayMs);
    expect(taskEdgeSchema.parse({...dependency,id:"edge",sourceNodeId:"upstream",targetNodeId:"downstream"}).delayMs).toBe(delayMs);
  });
  it.each([-1,0.5,604_800_001,Infinity,NaN,"300000"])("rejects invalid duration %s",delayMs=>{
    expect(semanticGraphDependencySchema.safeParse({stepKey:"upstream",delayMs}).success).toBe(false);
    expect(taskEdgeSchema.safeParse({id:"edge",sourceNodeId:"upstream",targetNodeId:"downstream",
      kind:"control",satisfactionPolicy:"all_success",failurePolicy:"block",delayMs}).success).toBe(false);
  });
  it("preserves omission and incremental graph authoring including replacement",()=>{
    expect(semanticGraphDependencySchema.parse({stepKey:"upstream"})).not.toHaveProperty("delayMs");
    const draft=new SemanticGraphDocumentDraft();
    draft.initialize({objective:"Cooldown",acceptanceCriteria:["runs later"]},0);
    draft.upsertNode({key:"upstream",title:"First",objective:"First",acceptanceCriteria:["done"]},1);
    draft.upsertNode({key:"downstream",title:"Next",objective:"Next",acceptanceCriteria:["done"]},2);
    const edge={sourceStepKey:"upstream",targetStepKey:"downstream",delayMs:300_000};
    expect(draft.upsertEdge(edge,3).edges[0]).toMatchObject({delayMs:300_000});
    expect(draft.submissionPlan(4).steps.find(step=>step.key==="downstream")!.dependsOn[0]).toMatchObject({delayMs:300_000});
    draft.upsertEdge({...edge,delayMs:1_000},4);
    expect(draft.submissionPlan(5).steps.find(step=>step.key==="downstream")!.dependsOn).toHaveLength(1);
    expect(draft.submissionPlan(5).steps.find(step=>step.key==="downstream")!.dependsOn[0]!.delayMs).toBe(1_000);
  });
});
