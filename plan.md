function calc_vp(open_imp, closed_imp, num_of_board) {
    const diff = Math.abs(open_imp - closed_imp);
    const tau = (5 ** 0.5 - 1) / 2;
    const b = 15 * num_of_board ** 0.5;
    let vp = 10 + 10 * ((1 - tau ** ((3 * diff) / b)) / (1 - tau ** 3));
    let anti_vp = 0;

    if (diff > b) {
        vp = 20.0;
        anti_vp = 0.0;
    } else {
        vp = Math.round(vp * 100) / 100;
        anti_vp = Math.round((20 - vp) * 100) / 100;
    }
    if (open_imp > closed_imp) {
        return [vp, anti_vp];
    } else {
        return [anti_vp, vp];
    }
}