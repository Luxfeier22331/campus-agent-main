import { SparklesIcon } from "./chat-icons";

const PREVIEW_SUGGESTIONS = [
  "图书馆今天开放到几点？",
  "校医院门诊现在怎么预约？",
  "宿舍报修应该提交到哪里？",
  "选课冲突如何申请人工处理？",
];

export function AuthPreview() {
  return (
    <div className="auth-preview-surface">
      <div className="auth-preview-header">
        <div className="auth-preview-header-mark">
          <SparklesIcon size={10} />
        </div>
        <span>Campus Agent</span>
      </div>

      <div className="auth-preview-body">
        <div className="auth-preview-copy">
          <h2>What can I help with?</h2>
          <p>Ask a grounded campus question and keep the thread for later.</p>
        </div>

        <div className="auth-preview-grid">
          {PREVIEW_SUGGESTIONS.map((suggestion) => (
            <button className="auth-preview-suggestion" key={suggestion} type="button">
              {suggestion}
            </button>
          ))}
        </div>
      </div>

      <div className="auth-preview-composer">
        <span>Ask anything...</span>
      </div>
    </div>
  );
}
