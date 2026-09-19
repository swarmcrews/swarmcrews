import {test} from 'node:test';
import assert from 'node:assert/strict';
import {toolResponseMetrics} from './trace-metrics.mjs';

test('resumed turns can reuse tool IDs without relabeling earlier results', () => {
  const call = (participantId, name) => ({participantId,payload:{kind:'tool_call',id:'item_1',name}});
  const result = (participantId, output) => ({participantId,payload:{kind:'tool_result',callId:'item_1',output}});
  const metrics = toolResponseMetrics([
    call('leader','submit_graph_plan'), call('worker','shell'), result('worker','worker'), result('leader','plan'),
    call('leader','get_graph_plan'), result('leader','view'),
  ]);
  assert.deepEqual(Object.keys(metrics).sort(), ['get_graph_plan','shell','submit_graph_plan']);
  assert.deepEqual(metrics.submit_graph_plan, {count:1,utf8Bytes:6,maxUtf8Bytes:6});
  assert.deepEqual(metrics.get_graph_plan, {count:1,utf8Bytes:6,maxUtf8Bytes:6});
  assert.deepEqual(metrics.shell, {count:1,utf8Bytes:8,maxUtf8Bytes:8});
});
