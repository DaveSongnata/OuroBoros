package handlers

import (
	"crypto/rand"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"time"
)

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func decodeJSON(r *http.Request, v any) error {
	defer r.Body.Close()
	return json.NewDecoder(r.Body).Decode(v)
}

// uuidV7 generates a UUIDv7 (time-ordered, random).
func uuidV7() string {
	var buf [16]byte

	// 48-bit Unix timestamp in milliseconds
	ms := uint64(time.Now().UnixMilli())
	binary.BigEndian.PutUint32(buf[0:4], uint32(ms>>16))
	binary.BigEndian.PutUint16(buf[4:6], uint16(ms))

	// Fill remaining bytes with random data
	rand.Read(buf[6:])

	// Set version (7) and variant (RFC 9562)
	buf[6] = (buf[6] & 0x0F) | 0x70 // version 7
	buf[8] = (buf[8] & 0x3F) | 0x80 // variant 10

	return hex.EncodeToString(buf[:4]) + "-" +
		hex.EncodeToString(buf[4:6]) + "-" +
		hex.EncodeToString(buf[6:8]) + "-" +
		hex.EncodeToString(buf[8:10]) + "-" +
		hex.EncodeToString(buf[10:16])
}

// shortID generates a NanoID-like 8-character alphanumeric string.
func shortID() string {
	const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
	buf := make([]byte, 8)
	rand.Read(buf)
	for i := range buf {
		buf[i] = alphabet[buf[i]%byte(len(alphabet))]
	}
	return string(buf)
}
