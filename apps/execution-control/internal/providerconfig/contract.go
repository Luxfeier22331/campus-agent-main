package providerconfig

const (
	CanonicalEmbeddingProvider   = "openai-compatible"
	CanonicalEmbeddingModel      = "Qwen3-Embedding-4B"
	CanonicalEmbeddingTransport  = "embeddings"
	CanonicalEmbeddingDimensions = 2560
)

func CanonicalEmbeddingContract() EmbeddingContractView {
	return EmbeddingContractView{
		Dimensions: CanonicalEmbeddingDimensions,
		Model:      CanonicalEmbeddingModel,
		Provider:   CanonicalEmbeddingProvider,
		Transport:  CanonicalEmbeddingTransport,
	}
}
