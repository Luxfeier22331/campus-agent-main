package observability

import (
	"fmt"
	"strings"
	"time"
)

func newHistogram() *routeHistogram {
	return &routeHistogram{
		Buckets: make([]uint64, len(durationBucketsMS)),
	}
}

func recordHistogramDuration(histogram *routeHistogram, duration time.Duration) {
	durationMS := float64(duration) / float64(time.Millisecond)
	histogram.Count++
	histogram.SumMS += durationMS
	for index, bound := range durationBucketsMS {
		if durationMS <= bound {
			histogram.Buckets[index]++
		}
	}
}

func newValueHistogram(bounds []float64) *valueHistogram {
	return &valueHistogram{
		Bounds:  append([]float64{}, bounds...),
		Buckets: make([]uint64, len(bounds)),
	}
}

func recordValueHistogram(histogram *valueHistogram, value float64) {
	histogram.Count++
	histogram.Sum += value
	for index, bound := range histogram.Bounds {
		if value <= bound {
			histogram.Buckets[index]++
		}
	}
}

func writeHistogram(
	builder *strings.Builder,
	name string,
	help string,
	histogram *routeHistogram,
) {
	builder.WriteString("# HELP " + name + " " + help + "\n")
	builder.WriteString("# TYPE " + name + " histogram\n")
	for index, bound := range durationBucketsMS {
		fmt.Fprintf(
			builder,
			"%s_bucket{le=%q} %d\n",
			name,
			formatFloat(bound),
			histogram.Buckets[index],
		)
	}
	fmt.Fprintf(builder, "%s_bucket{le=\"+Inf\"} %d\n", name, histogram.Count)
	fmt.Fprintf(builder, "%s_sum %s\n", name, formatFloat(histogram.SumMS))
	fmt.Fprintf(builder, "%s_count %d\n", name, histogram.Count)
}

func writeValueHistogramWithLabel(
	builder *strings.Builder,
	name string,
	help string,
	labelName string,
	labelValue string,
	histogram *valueHistogram,
) {
	builder.WriteString("# HELP " + name + " " + help + "\n")
	builder.WriteString("# TYPE " + name + " histogram\n")
	for index, bound := range histogram.Bounds {
		fmt.Fprintf(
			builder,
			"%s_bucket{%s=%q,le=%q} %d\n",
			name,
			labelName,
			labelValue,
			formatFloat(bound),
			histogram.Buckets[index],
		)
	}
	fmt.Fprintf(
		builder,
		"%s_bucket{%s=%q,le=\"+Inf\"} %d\n",
		name,
		labelName,
		labelValue,
		histogram.Count,
	)
	fmt.Fprintf(
		builder,
		"%s_sum{%s=%q} %s\n",
		name,
		labelName,
		labelValue,
		formatFloat(histogram.Sum),
	)
	fmt.Fprintf(
		builder,
		"%s_count{%s=%q} %d\n",
		name,
		labelName,
		labelValue,
		histogram.Count,
	)
}

func writeHistogramWithLabel(
	builder *strings.Builder,
	name string,
	help string,
	labelName string,
	labelValue string,
	histogram *routeHistogram,
) {
	builder.WriteString("# HELP " + name + " " + help + "\n")
	builder.WriteString("# TYPE " + name + " histogram\n")
	for index, bound := range durationBucketsMS {
		fmt.Fprintf(
			builder,
			"%s_bucket{%s=%q,le=%q} %d\n",
			name,
			labelName,
			labelValue,
			formatFloat(bound),
			histogram.Buckets[index],
		)
	}
	fmt.Fprintf(
		builder,
		"%s_bucket{%s=%q,le=\"+Inf\"} %d\n",
		name,
		labelName,
		labelValue,
		histogram.Count,
	)
	fmt.Fprintf(
		builder,
		"%s_sum{%s=%q} %s\n",
		name,
		labelName,
		labelValue,
		formatFloat(histogram.SumMS),
	)
	fmt.Fprintf(
		builder,
		"%s_count{%s=%q} %d\n",
		name,
		labelName,
		labelValue,
		histogram.Count,
	)
}
