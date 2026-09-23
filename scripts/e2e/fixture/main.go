// Command gate4e2eseed is a throwaway Gate 4 E2E fixture driver. It is NOT part
// of index-core and is never committed there. The Reference Web E2E copies this
// file into a disposable copy of an index-core checkout and runs it so the
// consumer can exercise Q5 (path ambiguity) and Q7 (removed resources) against
// real /v1 HTTP output.
//
// rclone is additive-only by frozen design (skipped_scopes UNKNOWN => never
// COMPLETE), so removal/ambiguity cannot be produced through the rclone path.
// The frozen contract explicitly allows controlled COMPLETE Snapshot fixtures
// for COMPLETE/removal Kernel correctness.
package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"log"
	"os"
	"time"

	"github.com/nathanxiangang-web/index-core/internal/domain"
	"github.com/nathanxiangang-web/index-core/internal/kernel/reconcile"
	"github.com/nathanxiangang-web/index-core/internal/store/postgres"
)

func main() {
	dsn := mustEnv("INDEXCORE_DATABASE_URL")
	rootB := mustEnv("E2E_ROOT_B") // removal fixture (grace 0, min-consec 1)
	rootC := mustEnv("E2E_ROOT_C") // ambiguity fixture (grace 1h, min-consec 5)

	ctx := context.Background()
	pool, err := postgres.Open(ctx, dsn)
	if err != nil {
		log.Fatalf("open: %v", err)
	}
	defer pool.Close()
	st := postgres.New(pool)

	log.Println("seeding removal fixture")
	seedRemoval(ctx, st, rootB)
	log.Println("seeding ambiguity fixture")
	seedAmbiguity(ctx, st, rootC)
	log.Println("seed complete")
}

func mustEnv(name string) string {
	v := os.Getenv(name)
	if v == "" {
		log.Fatalf("%s is required", name)
	}
	return v
}

func fileEntry(name, content string) domain.SnapshotEntry {
	alg := "sha256"
	sum := sha256.Sum256([]byte(content))
	h := hex.EncodeToString(sum[:])
	size := int64(len(content))
	mt := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	return domain.SnapshotEntry{
		EntryLocalID:  name,
		Name:          name,
		ParentRef:     "/",
		Size:          &size,
		Mtime:         &mt,
		ContentHash:   &h,
		HashAlgorithm: &alg,
	}
}

// seedRemoval: 4 entries -> 3 entries (first MISSING) -> 3 entries (confirmed
// REMOVED). The 1-of-4 drop stays below the 0.5 significant-shrink threshold,
// so each snapshot stays COMPLETE and may advance removal evidence.
func seedRemoval(ctx context.Context, st *postgres.Store, rootID string) {
	keepers := []domain.SnapshotEntry{
		fileEntry("keep1.txt", "keep-one"),
		fileEntry("keep2.txt", "keep-two"),
		fileEntry("keep3.txt", "keep-three"),
	}
	target := fileEntry("removal-target.txt", "removal-target")

	process(ctx, st, rootID, append([]domain.SnapshotEntry{target}, keepers...))
	process(ctx, st, rootID, keepers)
	process(ctx, st, rootID, keepers)
}

// seedAmbiguity: add amb.txt -> miss it (stays PRESENT within grace) -> re-add a
// DIFFERENT-content resource at the same path (R8 imposter => new resource),
// leaving two PRESENT canonical rows at /amb.txt => resolve_path ambiguous.
func seedAmbiguity(ctx context.Context, st *postgres.Store, rootID string) {
	keepers := []domain.SnapshotEntry{
		fileEntry("ck1.txt", "c-keep-one"),
		fileEntry("ck2.txt", "c-keep-two"),
		fileEntry("ck3.txt", "c-keep-three"),
	}
	ambV1 := fileEntry("amb.txt", "amb-version-one")
	ambV2 := fileEntry("amb.txt", "amb-version-two-different")

	process(ctx, st, rootID, append([]domain.SnapshotEntry{ambV1}, keepers...))
	process(ctx, st, rootID, keepers)
	process(ctx, st, rootID, append([]domain.SnapshotEntry{ambV2}, keepers...))
}

func process(ctx context.Context, st *postgres.Store, rootID string, entries []domain.SnapshotEntry) {
	snapID := reconcile.NewUUID()
	fresh := domain.FreshDirect
	strong := domain.StrongFailureVisibility
	count := int64(len(entries))
	snap := domain.Snapshot{
		SnapshotID:                     snapID,
		RootID:                         rootID,
		Provenance:                     []byte(`{"fixture":"gate4-reference-web-e2e"}`),
		ObservedAt:                     time.Now().UTC(),
		TraversalStatus:                domain.TraversalSuccess,
		SkippedScopesKnownEmpty:        true,
		FreshnessEvidence:              &fresh,
		CollectorCompletenessAssurance: &strong,
		CompletenessFlag:               domain.CompletenessFlagComplete,
		LifecycleState:                 domain.SnapshotDraft,
		EntryCount:                     &count,
	}
	must(st.InsertSnapshotStub(ctx, st.Pool(), snap))
	must(st.MarkSnapshotSubmitted(ctx, st.Pool(), snapID))
	for i := range entries {
		e := entries[i]
		e.SnapshotID = snapID
		must(st.InsertSnapshotEntry(ctx, st.Pool(), e))
	}
	cfg, err := st.RootReconcileConfig(ctx, rootID)
	must(err)
	coord := postgres.NewCoordinator(st, cfg)
	out, err := coord.ProcessSnapshot(ctx, rootID, snapID)
	must(err)
	fmt.Printf("root=%s snap=%s status=%s lifecycle=%s gen=%d applied=%d\n",
		rootID, snapID, out.Status, out.SnapshotLifecycle, out.Generation, out.AppliedGeneration)
}

func must(err error) {
	if err != nil {
		log.Fatalf("fatal: %v", err)
	}
}