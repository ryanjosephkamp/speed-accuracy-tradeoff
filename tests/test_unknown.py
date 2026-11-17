import numpy as np

from speed_accuracy import unknown
from speed_accuracy.known import belief_grid


def test_transition_rows_are_distributions():
    P = unknown.transition_matrix(belief_grid(200), 0.004)
    assert np.allclose(P.sum(axis=1), 1.0)


def test_bounds_collapse_over_time():
    ts, b = unknown.backward_induction(0.2, horizon=8.0, n=200, dt=0.01)
    early = b[ts <= 4.0]
    assert np.all(np.diff(early) <= 1e-9)
    assert early[0] - early[-1] > 0.1


def test_grid_refinement_changes_little():
    ts1, b1 = unknown.backward_induction(0.2, horizon=8.0, n=200, dt=0.01)
    ts2, b2 = unknown.backward_induction(0.2, horizon=8.0, n=400, dt=0.005)
    for t in (0.0, 0.5, 1.0, 2.0):
        assert abs(b1[np.argmin(np.abs(ts1 - t))] - b2[np.argmin(np.abs(ts2 - t))]) < 0.01
