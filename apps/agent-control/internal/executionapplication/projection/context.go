package projection

import "context"

type evidenceKey struct{}

// WithEvidence binds remote Activity evidence to this request, never a shared writer.
func WithEvidence(ctx context.Context, evidence InvocationEvidence) context.Context {
	return context.WithValue(ctx, evidenceKey{}, evidence)
}
func (s *Writer) InvocationEvidence(ctx context.Context) InvocationEvidence {
	if evidence, ok := ctx.Value(evidenceKey{}).(InvocationEvidence); ok {
		return evidence
	}
	return s.Evidence
}
