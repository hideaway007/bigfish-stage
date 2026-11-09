import React from 'react';
import type { ConnectionTestState } from '../../stageReducer';
import { mapConnectionFailure } from './connectionErrorMap';

interface ConnectionTestResultProps {
  target: 'worker' | 'voice';
  state: ConnectionTestState;
}

export const ConnectionTestResult: React.FC<ConnectionTestResultProps> = ({
  target,
  state,
}) => {
  if (!state.message) return null;

  const isOk = Boolean(state.ok);

  if (isOk) {
    return (
      <div
        className="p5-conn-card p5-conn-card--ok"
        data-testid={`${target}-conn-result`}
        role="status"
      >
        <div className="p5-conn-card-head">
          <span
            className="p5-conn-badge p5-conn-badge--ok"
            data-testid={`${target}-conn-status`}
          >
            ✓ 连接成功
          </span>
          <strong
            className="p5-conn-card-title"
            data-testid={`${target}-conn-title`}
          >
            {state.message}
          </strong>
          {state.latencyMs !== undefined && (
            <span
              className="p5-conn-latency"
              data-testid={`${target}-conn-latency`}
            >
              {state.latencyMs} ms
            </span>
          )}
        </div>
      </div>
    );
  }

  const diagnosis = mapConnectionFailure(state.message, target);

  return (
    <div
      className="p5-conn-card p5-conn-card--fail"
      data-testid={`${target}-conn-result`}
      role="alert"
    >
      <div className="p5-conn-card-head">
        <span
          className="p5-conn-badge p5-conn-badge--fail"
          data-testid={`${target}-conn-status`}
        >
          ✗ 连接失败
        </span>
        <strong
          className="p5-conn-card-title"
          data-testid={`${target}-conn-title`}
        >
          {diagnosis.title}
        </strong>
        {state.latencyMs !== undefined && (
          <span
            className="p5-conn-latency"
            data-testid={`${target}-conn-latency`}
          >
            {state.latencyMs} ms
          </span>
        )}
      </div>

      <div className="p5-conn-card-body">
        <div
          className="p5-conn-diag-row"
          data-testid={`${target}-conn-explanation`}
        >
          <span className="p5-conn-diag-label">原因说明</span>
          <span className="p5-conn-diag-text">{diagnosis.explanation}</span>
        </div>

        <div
          className="p5-conn-diag-row p5-conn-diag-row--step"
          data-testid={`${target}-conn-next-step`}
        >
          <span className="p5-conn-diag-label p5-conn-diag-label--step">
            下一步建议
          </span>
          <span className="p5-conn-diag-text">{diagnosis.nextStep}</span>
        </div>

        <details
          className="p5-conn-details"
          data-testid={`${target}-conn-details`}
        >
          <summary className="p5-conn-details-summary">详细信息</summary>
          <pre
            className="p5-conn-details-raw"
            data-testid={`${target}-conn-raw-msg`}
          >
            {diagnosis.rawMessage}
          </pre>
        </details>
      </div>
    </div>
  );
};
