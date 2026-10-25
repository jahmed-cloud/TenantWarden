package cmd

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
)

// installBinary copies the running executable to dst (unless it already runs from there),
// so the service doesn't depend on the download folder. It returns the path to run.
func installBinary(dst string) (string, error) {
	src, err := os.Executable()
	if err != nil {
		return "", err
	}
	if s, err := filepath.EvalSymlinks(src); err == nil {
		src = s
	}
	if same, _ := filepath.Abs(dst); same == src {
		return dst, nil
	}
	if err := os.MkdirAll(filepath.Dir(dst), 0755); err != nil {
		return "", fmt.Errorf("create %s: %w", filepath.Dir(dst), err)
	}
	in, err := os.Open(src)
	if err != nil {
		return "", err
	}
	defer in.Close()
	tmp := dst + ".new"
	out, err := os.OpenFile(tmp, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0755)
	if err != nil {
		return "", fmt.Errorf("copy agent to %s: %w", dst, err)
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		return "", err
	}
	if err := out.Close(); err != nil {
		return "", err
	}
	if err := os.Rename(tmp, dst); err != nil {
		return "", fmt.Errorf("replace %s (stop the running agent first): %w", dst, err)
	}
	return dst, nil
}
