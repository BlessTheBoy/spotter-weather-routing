from planner.domain.guidance import Instruction, main_roads, osrm_maneuver, road_key, tomtom_maneuver


def test_tomtom_maneuvers_fold_into_the_app_vocabulary():
    assert tomtom_maneuver("DEPART") == "depart"
    assert tomtom_maneuver("ARRIVE_RIGHT") == "arrive"
    assert tomtom_maneuver("TURN_LEFT") == "left"
    assert tomtom_maneuver("SHARP_RIGHT") == "right"
    assert tomtom_maneuver("KEEP_LEFT") == "slight_left"
    assert tomtom_maneuver("MOTORWAY_EXIT_RIGHT") == "slight_right"
    assert tomtom_maneuver("FOLLOW") == "straight"
    assert tomtom_maneuver("SOMETHING_NEW") == "straight"


def test_osrm_maneuvers():
    assert osrm_maneuver("depart", "right") == "depart"
    assert osrm_maneuver("turn", "sharp left") == "left"
    assert osrm_maneuver("fork", "slight right") == "slight_right"
    assert osrm_maneuver("new name", "straight") == "straight"
    assert osrm_maneuver("arrive", None) == "arrive"


def test_road_key_prefers_interstates_and_drops_direction():
    assert road_key(["US-11 N", "I-81 N"]) == "I-81"
    assert road_key(["US-29 S", "NC-49"]) == "US-29"
    assert road_key(["I 77"]) == "I-77"  # OSRM refs
    assert road_key([]) is None


def step(mile, key):
    return Instruction(mile, "straight", "", key, key)


def test_main_roads_are_the_two_longest_in_driving_order():
    steps = [step(0, None), step(2, "I-81"), step(300, "US-11"), step(310, "I-78"), step(500, None)]
    assert main_roads(steps, 520) == "I-81, I-78"


def test_one_road_carrying_the_trip_names_it_alone():
    steps = [step(0, None), step(1, "I-80"), step(495, "US-89")]
    assert main_roads(steps, 500) == "I-80"


def test_no_numbered_roads_means_no_name():
    assert main_roads([step(0, None)], 10) is None
