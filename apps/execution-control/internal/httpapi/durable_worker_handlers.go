package httpapi

import "net/http"

func (s *Server) handleDurableWorkerProcessNext(response http.ResponseWriter, request *http.Request) {
	writeRetiredDurableRoute(response)
}

func requiredPositiveIntFromMap(payload map[string]any, key string) int {
	value, ok := payload[key]
	if !ok {
		return 0
	}
	number, ok := value.(float64)
	if !ok || number <= 0 || number != float64(int(number)) {
		return 0
	}
	return int(number)
}
