"""CropSentinel AI — local image inference service.

Runs the two *genuine* trained classifiers the prototype ships with:

* cotton  — FarmGuard/cotton-densenet121 (DenseNet-121, 4 classes, MIT)
* soybean — ixrbhii/soybean-disease-convnext (ConvNeXt-Small, 6 classes, CC-BY-4.0)

The service is deliberately separate from the browser application: the published
weights are PyTorch checkpoints, and turning them into a browser runtime would
mean a conversion step plus ~130 MB of model downloads. A local HTTP service
that loads the original artifacts is the smallest integration that actually
executes the real model.

See `services/inference/README.md` for the API contract.
"""

__all__ = ["__version__"]

# Bumped whenever the response schema changes in a way a client must notice.
__version__ = "1.0.0"
