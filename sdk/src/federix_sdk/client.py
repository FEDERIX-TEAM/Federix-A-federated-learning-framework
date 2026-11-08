import re

from google.protobuf import message_factory

from federix_sdk._gen import admin_pb2, auth_pb2, client_pb2, events_pb2, fl_bridge_pb2, system_pb2
from federix_sdk.transport import Transport

SERVICES = {
    "auth": (auth_pb2, "AuthService"),
    "client": (client_pb2, "ClientService"),
    "admin": (admin_pb2, "AdminService"),
    "system": (system_pb2, "SystemService"),
    "fl": (fl_bridge_pb2, "FlBridgeService"),
    "events": (events_pb2, "EventStreamService"),
}


def snake(name):
    return re.sub(r"(?<!^)(?=[A-Z])", "_", name).lower()


class ServiceClient:
    def __init__(self, transport, descriptor, headers, hook=None):
        self._transport = transport
        self._descriptor = descriptor
        self._headers = headers
        self._hook = hook or (lambda: None)
        self._methods = {}
        for m in descriptor.methods:
            self._methods[m.name] = m
            self._methods[snake(m.name)] = m

    @property
    def name(self):
        return self._descriptor.full_name

    def methods(self):
        return [m.name for m in self._descriptor.methods]

    def __getattr__(self, attr):
        method = self._methods.get(attr)
        if method is None:
            raise AttributeError(f"{self._descriptor.full_name} has no method {attr!r}; available: {', '.join(self.methods())}")
        return self._caller(method)

    def _caller(self, method):
        input_cls = message_factory.GetMessageClass(method.input_type)
        output_cls = message_factory.GetMessageClass(method.output_type)
        service = self._descriptor.full_name

        def call(request=None, *, headers=None, timeout=None, **fields):
            if request is None:
                request = input_cls(**fields)
            elif fields:
                raise TypeError("pass either a request message or keyword fields, not both")
            def invoke():
                merged = {**self._headers(), **(headers or {})}
                if method.server_streaming:
                    return self._transport.server_stream(service, method.name, request, output_cls, headers=merged, timeout=timeout)
                return self._transport.unary(service, method.name, request, output_cls, headers=merged, timeout=timeout)

            hook = self._hook()
            if hook is None:
                return invoke()
            return hook(invoke, rpc=f"{service}/{method.name}", streaming=method.server_streaming)

        call.__name__ = snake(method.name)
        call.__doc__ = f"{service}/{method.name}: {method.input_type.name} -> {'stream ' if method.server_streaming else ''}{method.output_type.name}"
        return call


class FederixApi:
    def __init__(self, base_url, *, access_token=None, internal_token=None, timeout=30.0, connect_timeout=10.0, transport=None, call_hook=None):
        self.base_url = base_url.rstrip("/")
        self.transport = transport or Transport(base_url, timeout=timeout, connect_timeout=connect_timeout)
        self.access_token = access_token
        self.internal_token = internal_token
        self.call_hook = call_hook
        for attr, (module, service) in SERVICES.items():
            setattr(self, attr, ServiceClient(self.transport, module.DESCRIPTOR.services_by_name[service], self._auth_headers, lambda: self.call_hook))

    def _auth_headers(self):
        h = {}
        if self.access_token:
            h["authorization"] = f"Bearer {self.access_token}"
        if self.internal_token:
            h["x-internal-service-token"] = self.internal_token
        return h

    def close(self):
        self.transport.close()

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()
